// ═══════════════════════════════════════
//  C# ДЛЯ «СТУДИИ 3D» — скрипты на C# как в Unity: свой переводчик C# → JavaScript (без библиотек и без сети)
// ═══════════════════════════════════════
// Переводчик работает ВНУТРИ песочницы скриптов (worker() уходит туда текстом): лексер → парсер (дерево) → генератор JS со
// статическими типами (int / float / string / Vector3 …: целочисленное деление, (int) — к нулю, числа в строках как в C#) →
// new Function. Каждый кусок JS помечен строкой C# (карта «строка:столбец JS → строка C#», //# sourceURL=d37cs-N.js), поэтому
// ошибки — и при переводе, и во время игры — приходят с номером строки C#.
// Два стиля: инструкции верхнего уровня (C# 9) с API как в Roblox (part.Touched += …) и классы как в Unity:
// class X : Script (или MonoBehaviour) { Start, Update(dt), OnTouched(hit, player), OnClicked(player), корутины IEnumerator +
// yield return new WaitForSeconds(…), async/await Task.Delay }. List = массив JS, методы C# (Add, Count, Where…) — на прототипах
// внутри песочницы. Vector3: + − * / == — через помощников $.add/$.sub/… (у чисел — обычные операторы JS).
// Не поддерживается: LINQ-запросы from…select, goto, unsafe/указатели, record, операторы приведения, переполнение int,
// ref-локальные; struct — как class (копия при присваивании). Тесты: node scripts/lang-cs-test.cjs
(() => {
  const E = window.D37E = window.D37E || {};

  // ═══ Всё, что ниже, работает внутри песочницы. Снаружи эта функция ничего не видит ═══
  function worker(){
    'use strict';
    const CH = String.fromCharCode;
    const MK = CH(1), MK2 = CH(2);                 // метка строки C# в тексте JS: MK + строка + MK2
    const mark = line => MK + line + MK2;
    function CsErr(msg, line){ const e = new Error(msg); e.cs = true; e.line = line || 0; return e; }

    // ═══ 1. Лексер: текст → токены { k: id|kw|num|str|chr|istr|op|eof, v, line, s, e } ═══
    const KW = new Set(('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum ' +
      'event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object ' +
      'operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this ' +
      'throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while').split(' '));
    const OPS3 = ['<<=', '??='];
    const OPS2 = ['=>', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '??', '::', '..', '->'];
    const OPS1 = '{}()[].,:;+-*/%&|^!~=<>?';
    const isD = c => c >= '0' && c <= '9';
    const isHex = c => isD(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    const isIdS = c => !!c && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || (c.charCodeAt(0) > 127 && /\p{L}/u.test(c)));
    const isIdC = c => !!c && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || isD(c) || c === '_' || (c.charCodeAt(0) > 127 && /[\p{L}\p{N}\p{Mn}\p{Mc}\p{Pc}]/u.test(c)));
    const ESC = { n: '\n', t: '\t', r: '\r', '0': CH(0), a: CH(7), b: CH(8), f: CH(12), v: CH(11), '\\': '\\', "'": "'", '"': '"' };

    function lex(src, line0){
      const T = [], n = src.length;
      let i = 0, line = line0 || 1, ws = true, bol = true;
      const tok = (k, v, s, tl, x) => { const t = { k, v, line: tl, s, e: i, ws }; if (x) Object.assign(t, x); T.push(t); ws = false; bol = false; return t; };
      function escape(){   // src[i] === '\\'
        const d = src[i + 1];
        if (d === 'u' || d === 'U' || d === 'x') {
          let j = i + 2, h = '';
          const max = d === 'U' ? 8 : 4;
          while (h.length < max && isHex(src[j])) h += src[j++];
          if (!h || (d !== 'x' && h.length !== max)) throw CsErr('Неверная escape-последовательность \\' + d, line);
          i = j; return String.fromCodePoint(parseInt(h, 16));
        }
        if (d !== undefined && Object.prototype.hasOwnProperty.call(ESC, d)) { i += 2; return ESC[d]; }
        throw CsErr('Неизвестная escape-последовательность \\' + (d || ''), line);
      }
      function skipLit(){   // вложенная строка/символ внутри {…} в $"…"
        let verb = false;
        while (src[i] === '@' || src[i] === '$') { if (src[i] === '@') verb = true; i++; }
        const q = src[i]; i++;
        while (i < n) {
          const d = src[i];
          if (d === '\\' && !verb) { i += 2; continue; }
          if (d === q) { if (verb && q === '"' && src[i + 1] === '"') { i += 2; continue; } i++; return; }
          if (d === '\n') { if (!verb) throw CsErr('Незакрытая строка', line); line++; }
          i++;
        }
        throw CsErr('Незакрытая строка', line);
      }
      while (i < n) {
        const c = src[i], cc = src.charCodeAt(i);
        if (c === '\n') { line++; i++; ws = true; bol = true; continue; }
        if (c === ' ' || c === '\t' || c === '\r' || cc === 11 || cc === 12 || cc === 0xA0 || cc === 0xFEFF || (cc >= 0x2000 && cc <= 0x200B) || cc === 0x3000 || cc === 0x202F) { i++; ws = true; continue; }
        if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; ws = true; continue; }
        if (c === '/' && src[i + 1] === '*') {
          const l0 = line; i += 2;
          while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
          if (i >= n) throw CsErr('Незакрытый комментарий /* … */', l0);
          i += 2; ws = true; continue;
        }
        if (c === '#' && bol) { while (i < n && src[i] !== '\n') i++; continue; }   // #region, #if … — пропускаем строку
        const s = i, tl = line;
        // ── числа: 12, 1.5f, 2d, 10L, 3m, 0xFF, 0b101, 1_000, 1e3 ──
        if (isD(c) || (c === '.' && isD(src[i + 1]))) {
          let real = false, base = 10;
          if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) { i += 2; base = 16; while (i < n && (isHex(src[i]) || src[i] === '_')) i++; }
          else if (c === '0' && (src[i + 1] === 'b' || src[i + 1] === 'B')) { i += 2; base = 2; while (i < n && (src[i] === '0' || src[i] === '1' || src[i] === '_')) i++; }
          else {
            while (i < n && (isD(src[i]) || src[i] === '_')) i++;
            if (src[i] === '.' && isD(src[i + 1])) { real = true; i++; while (i < n && (isD(src[i]) || src[i] === '_')) i++; }
            if ((src[i] === 'e' || src[i] === 'E') && (isD(src[i + 1]) || ((src[i + 1] === '+' || src[i + 1] === '-') && isD(src[i + 2])))) { real = true; i += 2; while (i < n && isD(src[i])) i++; }
          }
          const body = src.slice(s, i).replace(/_/g, '');
          let suf = '';
          while (i < n && /[fFdDmMuUlL]/.test(src[i])) suf += src[i++].toLowerCase();
          if (isIdC(src[i])) throw CsErr('Неверное число «' + src.slice(s, i + 1) + '»', line);
          const v = base === 16 ? parseInt(body.slice(2), 16) : base === 2 ? parseInt(body.slice(2), 2) : parseFloat(body);
          if (body.length <= 2 && base !== 10) throw CsErr('Неверное число «' + src.slice(s, i) + '»', line);
          const nt = suf.includes('f') ? 'float' : suf.includes('d') ? 'double' : suf.includes('m') ? 'decimal' : real ? 'double' : 'int';
          if (nt === 'int' && (suf.includes('f') || suf.includes('d'))) throw CsErr('Неверное число', line);
          tok('num', v, s, tl, { nt });
          continue;
        }
        // ── строки: "…", @"…", $"…{x:F2}…", $@"…" ──
        if (c === '"' || ((c === '@' || c === '$') && (src[i + 1] === '"' || ((src[i + 1] === '@' || src[i + 1] === '$') && src[i + 2] === '"')))) {
          let pre = '';
          while (src[i] === '@' || src[i] === '$') pre += src[i++];
          if (src[i + 1] === '"' && src[i + 2] === '"' && !pre.includes('@')) throw CsErr('Сырые строки """…""" не поддерживаются — используй @"…"', line);
          if (pre.length > 2 || pre === '$$' || pre === '@@') throw CsErr('Строки ' + pre + '"…" не поддерживаются', line);
          i++;
          const verb = pre.includes('@'), interp = pre.includes('$');
          if (!interp) {
            let v = '';
            for (;;) {
              if (i >= n) throw CsErr('Незакрытая строка (нет второй кавычки ")', tl);
              const d = src[i];
              if (d === '"') { if (verb && src[i + 1] === '"') { v += '"'; i += 2; continue; } i++; break; }
              if (d === '\n') { if (!verb) throw CsErr('Незакрытая строка (нет второй кавычки ")', tl); line++; v += d; i++; continue; }
              if (d === '\\' && !verb) { v += escape(); continue; }
              if (d === '\r' && verb) { i++; continue; }
              v += d; i++;
            }
            tok('str', v, s, tl);
            continue;
          }
          const parts = []; let buf = '';
          for (;;) {
            if (i >= n) throw CsErr('Незакрытая строка $"…"', tl);
            const d = src[i];
            if (d === '"') { if (verb && src[i + 1] === '"') { buf += '"'; i += 2; continue; } i++; break; }
            if (d === '\n') { if (!verb) throw CsErr('Незакрытая строка $"…"', tl); line++; buf += d; i++; continue; }
            if (d === '\\' && !verb) { buf += escape(); continue; }
            if (d === '\r' && verb) { i++; continue; }
            if (d === '}') { if (src[i + 1] === '}') { buf += '}'; i += 2; continue; } throw CsErr('Одиночная «}» в строке $"…" — пиши }}', line); }
            if (d !== '{') { buf += d; i++; continue; }
            if (src[i + 1] === '{') { buf += '{'; i += 2; continue; }
            parts.push(buf); buf = '';
            i++;
            const hs = i, hl = line;
            let dep = 0, al = -1, alL = 0, fm = -1;
            for (;;) {
              if (i >= n) throw CsErr('Незакрытая «{» в строке $"…"', hl);
              const h = src[i];
              if (h === '"' || h === "'" || ((h === '@' || h === '$') && (src[i + 1] === '"' || src[i + 1] === '@' || src[i + 1] === '$'))) { skipLit(); continue; }
              if (h === '\n') { line++; i++; continue; }
              if (h === '(' || h === '[' || h === '{') dep++;
              else if (h === ')' || h === ']') dep--;
              else if (h === '}') { if (dep === 0) break; dep--; }
              else if (dep === 0 && h === ',' && al < 0) { al = i; alL = line; }
              else if (dep === 0 && h === ':') {
                if (src[i + 1] === ':') { i += 2; continue; }
                fm = i; i++;
                while (i < n && src[i] !== '}' && src[i] !== '\n') i++;
                if (src[i] !== '}') throw CsErr('Формат в {…:…} — до «}» на той же строке', line);
                break;
              }
              i++;
            }
            const end = i, ee = al >= 0 ? al : fm >= 0 ? fm : end;
            const etxt = src.slice(hs, ee);
            if (!etxt.trim()) throw CsErr('Пустое выражение {} в строке $"…"', hl);
            parts.push({ toks: lex(etxt, hl), al: al >= 0 ? lex(src.slice(al + 1, fm >= 0 ? fm : end), alL) : null, fmt: fm >= 0 ? src.slice(fm + 1, end) : null, line: hl });
            i = end + 1;
          }
          parts.push(buf);
          tok('istr', parts, s, tl);
          continue;
        }
        // ── символ: 'a', '\n', 'A' ──
        if (c === "'") {
          i++;
          let v;
          if (src[i] === '\\') v = escape();
          else { if (i >= n || src[i] === "'" || src[i] === '\n') throw CsErr("Пустой символ ''", line); v = src[i]; i++; }
          if (src[i] !== "'") throw CsErr("В '…' — ровно один символ (строка пишется в двойных кавычках \"…\")", line);
          i++;
          tok('chr', v, s, tl);
          continue;
        }
        // ── имена и ключевые слова (@class — имя) ──
        if (isIdS(c) || (c === '@' && isIdS(src[i + 1]))) {
          const verb = c === '@'; if (verb) i++;
          const st = i;
          while (i < n && isIdC(src[i])) i++;
          const v = src.slice(st, i);
          tok(!verb && KW.has(v) ? 'kw' : 'id', v, s, tl, verb ? { verb: true } : null);
          continue;
        }
        // ── операторы (>> не склеиваем: List<List<int>> — склеивает парсер) ──
        let op = null;
        if (OPS3.includes(src.substr(i, 3))) op = src.substr(i, 3);
        else if (c === '?' && src[i + 1] === '.' && !isD(src[i + 2])) op = '?.';
        else if (OPS2.includes(src.substr(i, 2))) op = src.substr(i, 2);
        else if (OPS1.includes(c)) op = c;
        if (op) {
          if (op === '->') throw CsErr('Указатели (->) не поддерживаются', line);
          i += op.length; tok('op', op, s, tl);
          continue;
        }
        if (c === '`') throw CsErr('Символ ` в C# не используется (строки — в кавычках "…", $"…{x}…")', line);
        throw CsErr('Непонятный символ «' + c + '»', line);
      }
      T.push({ k: 'eof', v: '', line, s: i, e: i, ws: true });
      return T;
    }

    // ═══ 2. Парсер: токены → дерево. Выражения { k: … }, инструкции { s: … }, шаблоны { p: … }, члены классов { m: … } ═══
    const PREDEF = { bool: 'bool', byte: 'int', sbyte: 'int', short: 'int', ushort: 'int', int: 'int', uint: 'int', long: 'int', ulong: 'int',
      char: 'char', float: 'float', double: 'double', decimal: 'decimal', string: 'string', object: 'object', void: 'void' };
    const TMODS = new Set(['public', 'private', 'protected', 'internal', 'static', 'abstract', 'sealed', 'partial', 'unsafe', 'readonly', 'new', 'file', 'ref']);
    const MMODS = new Set(['public', 'private', 'protected', 'internal', 'static', 'readonly', 'volatile', 'new', 'override', 'virtual', 'abstract', 'sealed', 'extern', 'unsafe']);
    const CMODS = new Set(['async', 'partial', 'required']);   // контекстные (это имена, если дальше ( = ;)
    const ASG = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=', '??=']);
    const PREC = { '??': 1, '||': 2, '&&': 3, '|': 4, '^': 5, '&': 6, '==': 7, '!=': 7, '<': 8, '>': 8, '<=': 8, '>=': 8, is: 8, as: 8, '<<': 9, '>>': 9, '>>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11 };

    function parse(T){
      let p = 0;
      const pk = (o = 0) => T[Math.min(p + o, T.length - 1)];
      const nx = () => T[p++];
      const is = (v, o = 0) => { const t = pk(o); return (t.k === 'op' || t.k === 'kw') && t.v === v; };
      const isId = (v, o = 0) => { const t = pk(o); return t.k === 'id' && !t.verb && (v === undefined || t.v === v); };
      const tokText = t => t.k === 'eof' ? 'конец кода' : t.k === 'str' ? '"' + t.v.slice(0, 20) + '"' : t.k === 'istr' ? '$"…"' : t.k === 'chr' ? "'" + t.v + "'" : String(t.v);
      const fail = (msg, t = pk()) => { throw CsErr(msg + (t.k === 'eof' ? ', а код закончился' : ', а здесь «' + tokText(t) + '»'), t.line); };
      const eat = v => { if (is(v)) { p++; return true; } return false; };
      const want = (v, msg) => {   // не хватает «;» / «)» в конце строки — ошибка на этой строке, а не на следующей
        if (!is(v)) { const t = pk(), pr = T[p - 1]; if (pr && t.line > pr.line && (v === ';' || v === ')' || v === ']')) throw CsErr((msg || 'Ожидалось «' + v + '»') + ' в конце строки', pr.line); fail(msg || 'Ожидалось «' + v + '»'); }
        return nx();
      };
      const name = what => { const t = pk(); if (t.k !== 'id') fail('Ожидалось имя' + (what ? ' ' + what : '')); p++; return t.v; };
      const match = (i, open, close) => { let d = 0; for (let j = i; j < T.length; j++) { const t = T[j]; if (t.k === 'eof') return -1; if (t.k !== 'op') continue; if (open.includes(t.v)) d++; else if (close.includes(t.v)) { d--; if (d === 0) return j; if (d < 0) return -1; } } return -1; };
      const startsExpr = t => t.k === 'id' || t.k === 'num' || t.k === 'str' || t.k === 'chr' || t.k === 'istr' ||
        (t.k === 'op' && ['(', '[', '!', '~', '-', '+', '++', '--', '^'].includes(t.v)) || (t.k === 'kw' && (['this', 'base', 'new', 'typeof', 'default', 'true', 'false', 'null', 'checked', 'unchecked', 'delegate', 'throw'].includes(t.v) || !!PREDEF[t.v]));
      function attrs(){ while (is('[')) { const c = match(p, '[', ']'); if (c < 0) fail('Не хватает «]»'); p = c + 1; } }

      // ── типы: int, string[], List<int>, Dictionary<string, int>, int?, (int, string), System.Collections.Generic.List<T> ──
      function type(o = {}){
        const s = p;
        let t = baseType();
        if (t === null) { p = s; return null; }
        for (;;) {
          if (is('?') && !o.noNull) { const u = pk(1); if (u.k === 'id' || (u.k === 'op' && ['>', ',', ')', '[', ']', '='].includes(u.v))) { p++; t += '?'; continue; } }
          if (is('[') && (is(']', 1) || is(',', 1))) { p++; let r = 1; while (eat(',')) r++; if (!eat(']')) { p = s; return null; } t += '[' + ','.repeat(r - 1) + ']'; continue; }
          break;
        }
        return t;
      }
      function baseType(){
        const t = pk();
        if (t.k === 'kw' && PREDEF[t.v]) { p++; return PREDEF[t.v]; }
        if (is('(')) {
          p++; const el = [];
          do { const et = type(); if (!et) return null; let nm = ''; if (pk().k === 'id' && (is(',', 1) || is(')', 1))) nm = nx().v; el.push(nm ? et + ' ' + nm : et); } while (eat(','));
          if (!eat(')') || el.length < 2) return null;
          return '(' + el.join(',') + ')';
        }
        if (t.k !== 'id') return null;
        if (!t.verb && t.v === 'dynamic') { p++; return 'object'; }
        if (!t.verb && (t.v === 'nint' || t.v === 'nuint')) { p++; return 'int'; }
        if (isId('global') && is('::', 1)) p += 2;
        let nm = '', args = null;
        for (;;) {
          const id = pk(); if (id.k !== 'id') return null;
          p++;
          if (is('::')) { p++; continue; }
          nm = id.v; args = null;
          if (is('<')) { const a = typeArgs(); if (a === null) return null; args = a; }
          if (is('.') && pk(1).k === 'id') { p++; continue; }
          break;
        }
        return args ? nm + '<' + args.join(',') + '>' : nm;
      }
      function typeArgs(){   // < T, U > — null, если это не аргументы типа
        const s = p; p++;
        if (is('>')) { p++; return ['']; }
        const a = [];
        for (;;) { const t = type(); if (!t) { p = s; return null; } a.push(t); if (eat(',')) continue; if (eat('>')) return a; p = s; return null; }
      }
      function genericHere(){   // имя<…> в выражении: аргументы типа, если после > идёт ( ) ] } : ; , . ? == != | ^ && || & [
        const s = p, a = typeArgs(); if (a === null) return null;
        const t = pk();
        if (t.k === 'eof' || (t.k === 'op' && ['(', ')', ']', '}', ':', ';', ',', '.', '?', '?.', '==', '!=', '|', '^', '&&', '||', '&', '['].includes(t.v))) return a;
        p = s; return null;
      }

      // ── единица компиляции: using, namespace, типы, инструкции верхнего уровня ──
      function unit(){
        const stmts = [], types = [];
        let ns = 0;
        while (pk().k !== 'eof') {
          if (isId('global') && is('using', 1)) p++;
          if (is('using') && usingDirective()) continue;
          if (is('namespace')) { p++; if (!type()) fail('Ожидалось имя namespace'); if (eat(';')) continue; want('{'); ns++; continue; }
          if (is('}') && ns > 0) { p++; ns--; continue; }
          if (isId('extern') && isId('alias', 1)) { while (!is(';') && pk().k !== 'eof') p++; eat(';'); continue; }
          if (is('[') && (isId('assembly', 1) || isId('module', 1)) && is(':', 2)) { attrs(); continue; }
          if (typeAhead()) { types.push(typeDecl()); continue; }
          while (is('public') || is('private') || is('internal') || is('protected')) p++;   // мягко: модификаторы у кода верхнего уровня
          stmts.push(stmt());
        }
        if (ns > 0) fail('Не хватает «}» у namespace');
        return { stmts, types };
      }
      function usingDirective(){   // using X.Y; using static X; using A = X.Y;  (но не using (…) и не using var …)
        const s = p; p++;
        if (is('(') || isId('var')) { p = s; return false; }
        if (is('static')) { while (!is(';') && pk().k !== 'eof') p++; want(';'); return true; }
        if (pk().k === 'id' && is('=', 1)) { while (!is(';') && pk().k !== 'eof') p++; want(';'); return true; }
        const ty = type();
        if (ty && pk().k === 'id') { p = s; return false; }   // using Type x = …;
        if (!ty || !eat(';')) fail('Ожидалось «using Имя;»');
        return true;
      }
      function typeAhead(){   // после атрибутов и модификаторов — class / struct / interface / enum / record / delegate?
        let o = 0;
        for (;;) {
          const t = pk(o);
          if (t.k === 'op' && t.v === '[') { const c = match(p + o, '[', ']'); if (c < 0) return false; o = c - p + 1; continue; }
          if ((t.k === 'kw' || (t.k === 'id' && !t.verb)) && TMODS.has(t.v)) { o++; continue; }
          if (t.k === 'kw' && (t.v === 'class' || t.v === 'struct' || t.v === 'interface' || t.v === 'enum')) return true;
          if (t.k === 'kw' && t.v === 'delegate') { const u = pk(o + 1); return !(u.k === 'op' && (u.v === '(' || u.v === '{')); }
          return t.k === 'id' && !t.verb && t.v === 'record' && pk(o + 1).k === 'id';
        }
      }
      function typeDecl(){
        attrs();
        const mods = new Set();
        while ((pk().k === 'kw' || isId()) && TMODS.has(pk().v)) mods.add(nx().v);
        const t = nx(), line = t.line;
        if (t.v === 'record') throw CsErr('record не поддерживается — используй class', line);
        if (t.v === 'delegate') { const ret = type(); if (!ret) fail('Ожидался тип'); const nm = name('делегата'); if (is('<')) typeArgs(); want('('); const ps = params(); want(';'); return { kind: 'delegate', name: nm, ret, params: ps, line, mods }; }
        if (t.v === 'enum') {
          const nm = name('перечисления'); if (eat(':')) type();
          want('{'); const items = [];
          while (!is('}')) { attrs(); const il = pk().line, inm = name('элемента enum'); let e = null; if (eat('=')) e = expr(); items.push({ name: inm, e, line: il }); if (!eat(',')) break; }
          const end = want('}').line; eat(';');
          return { kind: 'enum', name: nm, items, line, end, mods };
        }
        const nm = name(t.v === 'class' ? 'класса' : t.v === 'struct' ? 'структуры' : 'интерфейса');
        let tps = null; if (is('<')) tps = typeArgs() || fail('Ожидались параметры типа');
        if (is('(')) throw CsErr('Первичные конструкторы ' + t.v + ' ' + nm + '(…) не поддерживаются — объяви конструктор внутри', line);
        const bases = [];
        if (eat(':')) do { const b = type(); if (!b) fail('Ожидался базовый класс или интерфейс'); bases.push(b); } while (eat(','));
        while (isId('where')) { p++; while (!is('{') && pk().k !== 'eof') p++; }
        want('{', 'Ожидалось «{» — начало класса ' + nm);
        const members = [];
        while (!is('}')) { if (pk().k === 'eof') fail('Не хватает «}» у ' + nm); const m = member(nm); if (m) members.push(m); }
        const end = nx().line; eat(';');
        return { kind: t.v, name: nm, tps, bases, members, mods, line, end };
      }
      function member(cname){
        attrs();
        const line = pk().line;
        if (eat(';')) return null;
        if (typeAhead()) return { m: 'type', decl: typeDecl(), line };
        const mods = new Set();
        for (;;) {
          const t = pk();
          if (t.k === 'kw' && MMODS.has(t.v)) { mods.add(nx().v); continue; }
          if (t.k === 'id' && !t.verb && CMODS.has(t.v) && !(pk(1).k === 'op' && ['(', '=', ';', '{', '=>', ','].includes(pk(1).v))) { mods.add(nx().v); continue; }
          break;
        }
        if (eat('~')) { name(); want('('); want(')'); block(); return null; }   // деструктор — не нужен
        if (is('event')) {
          p++; const ty = type(); if (!ty) fail('Ожидался тип события');
          if (pk().k === 'id' && is('{', 1)) throw CsErr('event с add/remove не поддерживается', line);
          return { m: 'field', ty, decls: fieldDecls(), mods, isEvent: true, line };
        }
        if (is('const')) { p++; const ty = type(); if (!ty) fail('Ожидался тип константы'); mods.add('static'); return { m: 'field', ty, decls: fieldDecls(), mods, isConst: true, line }; }
        if (is('implicit') || is('explicit')) throw CsErr('Операторы приведения (implicit/explicit operator) не поддерживаются', line);
        if (pk().k === 'id' && pk().v === cname && is('(', 1)) {   // конструктор
          p += 2; const ps = params();
          let init = null;
          if (eat(':')) { const kw = nx(); if (kw.v !== 'base' && kw.v !== 'this') fail('Ожидалось base(…) или this(…)', kw); want('('); init = { kind: kw.v, args: argList(), line: kw.line }; }
          let body = null;
          if (is('{')) body = block();
          else if (eat('=>')) { const ex = expr(); want(';'); body = { s: 'block', body: [{ s: 'expr', e: ex, line }], line, end: line }; }
          else want(';');
          const fn = { name: cname, ret: 'void', params: ps, body, ex: null, mods, line, tps: null };
          return mods.has('static') ? { m: 'sctor', fn, line } : { m: 'ctor', fn, init, line };
        }
        const ty = type(); if (!ty) fail('Ожидалось объявление поля, свойства или метода');
        if (is('operator')) {
          p++;
          let op = nx().v;
          if (op === '>' && is('>') && pk().s === T[p - 1].e) { p++; op = '>>'; }
          if (op === 'true' || op === 'false') throw CsErr('operator true/false не поддерживается', line);
          want('('); const ps = params();
          let body = null, ex = null;
          if (is('{')) body = block(); else { want('=>'); ex = expr(); want(';'); }
          return { m: 'op', op: ps.length === 1 ? 'u' + op : op, fn: { name: 'op', ret: ty, params: ps, body, ex, mods, line, tps: null }, line };
        }
        if (is('this') && is('[', 1)) { p += 2; const ps = params(']'); return { m: 'indexer', ty, params: ps, acc: accessors(), mods, line }; }
        if (pk().k !== 'id') fail('Ожидалось имя поля, свойства или метода');
        if (is('(', 1) || (is('<', 1) && genericMethodAhead())) return { m: 'method', fn: funcRest(ty, [...mods], line), line };
        if (is('{', 1)) {
          const nm = nx().v, acc = accessors();
          let init = null; if (eat('=')) { init = is('{') ? arrInit() : expr(); want(';'); }
          return { m: 'prop', ty, name: nm, acc, init, mods, line };
        }
        if (is('=>', 1)) { const nm = nx().v; p++; const ex = expr(); want(';'); return { m: 'prop', ty, name: nm, acc: { get: { ex, line } }, init: null, mods, line }; }
        return { m: 'field', ty, decls: fieldDecls(), mods, line };
      }
      function genericMethodAhead(){ const s = p; p++; const a = typeArgs(); const ok = a !== null && is('('); p = s; return ok; }
      function fieldDecls(){
        const decls = [];
        do { const nl = pk().line, nm = name('поля'); let init = null; if (eat('=')) init = is('{') ? arrInit() : expr(); decls.push({ name: nm, init, line: nl }); } while (eat(','));
        want(';');
        return decls;
      }
      function accessors(){
        want('{'); const acc = {};
        while (!eat('}')) {
          attrs(); const al = pk().line;
          while (is('private') || is('protected') || is('internal') || is('public') || is('readonly')) p++;
          const k = nx();
          if (k.k !== 'id' || !['get', 'set', 'init'].includes(k.v)) fail('Ожидалось get или set', k);
          const key = k.v === 'get' ? 'get' : 'set';
          if (eat(';')) acc[key] = { auto: true, line: al };
          else if (is('{')) acc[key] = { body: block(), line: al };
          else { want('=>'); acc[key] = { ex: expr(), line: al }; want(';'); }
        }
        return acc;
      }
      function params(close = ')'){
        const ps = [];
        if (eat(close)) return ps;
        do {
          attrs();
          let mod = null;
          if (is('ref') || is('out') || is('in') || is('params') || is('this')) { mod = nx().v; if (mod === 'ref' && is('readonly')) p++; }
          if (isId('scoped')) p++;
          const pl = pk().line, ty = type();
          if (!ty) fail('Ожидался тип параметра');
          const nm = name('параметра');
          let def = null; if (eat('=')) def = expr();
          ps.push({ name: nm, ty, mod, def, line: pl });
        } while (eat(','));
        want(close);
        return ps;
      }
      function funcRest(ret, mods, line){   // после типа результата: Имя<T>(параметры) { … } | => выражение;
        const nm = name('метода');
        let tps = null; if (is('<')) tps = typeArgs();
        want('('); const ps = params();
        while (isId('where')) { p++; while (!is('{') && !is('=>') && !is(';') && pk().k !== 'eof') p++; }
        let body = null, ex = null;
        if (is('{')) body = block();
        else if (eat('=>')) { ex = expr(); want(';'); }
        else if (!eat(';')) fail('Ожидалось тело метода { … }');
        return { name: nm, ret, tps, params: ps, body, ex, mods: new Set(mods), line };
      }

      // ── инструкции ──
      function block(){
        const line = want('{').line, body = [];
        while (!is('}')) { if (pk().k === 'eof') fail('Не хватает «}»'); body.push(stmt()); }
        return { s: 'block', body, line, end: nx().line };
      }
      function stmt(){
        const t = pk(), line = t.line;
        if (is('{')) return block();
        if (is(';')) { p++; return { s: 'empty', line }; }
        if (t.k === 'kw') switch (t.v) {
          case 'if': { p++; want('('); const c = expr(); want(')'); const a = stmt(); let b = null; if (eat('else')) b = stmt(); return { s: 'if', c, a, b, line }; }
          case 'while': { p++; want('('); const c = expr(); want(')'); return { s: 'while', c, body: stmt(), line }; }
          case 'do': { p++; const body = stmt(); want('while', 'Ожидалось «while» после тела do'); want('('); const c = expr(); want(')'); want(';'); return { s: 'do', body, c, line }; }
          case 'for': return forStmt();
          case 'foreach': return foreachStmt();
          case 'switch': return switchStmt();
          case 'break': p++; want(';'); return { s: 'break', line };
          case 'continue': p++; want(';'); return { s: 'continue', line };
          case 'return': { p++; const e = is(';') ? null : expr(); want(';'); return { s: 'return', e, line }; }
          case 'throw': { p++; const e = is(';') ? null : expr(); want(';'); return { s: 'throw', e, line }; }
          case 'try': return tryStmt();
          case 'using': return usingStmt();
          case 'lock': { p++; want('('); const e = expr(); want(')'); return { s: 'lock', e, body: stmt(), line }; }
          case 'checked': case 'unchecked': if (is('{', 1)) { p++; return block(); } break;
          case 'const': { p++; const ty = type(); if (!ty) fail('Ожидался тип константы'); return varDecl(ty, line, true); }
          case 'goto': throw CsErr('goto не поддерживается — используй циклы, break и return', line);
          case 'fixed': case 'unsafe': throw CsErr(t.v + ' (указатели) не поддерживается', line);
          case 'class': case 'struct': case 'interface': case 'enum': throw CsErr(t.v + ' объявляй не внутри метода, а отдельно (после кода верхнего уровня)', line);
        }
        if (isId('yield') && (is('return', 1) || is('break', 1))) {
          p++;
          if (eat('break')) { want(';'); return { s: 'ybrk', line }; }
          p++; const e = expr(); want(';');
          return { s: 'yret', e, line };
        }
        if (isId('await') && is('foreach', 1)) throw CsErr('await foreach не поддерживается', line);
        if (isId() && is(':', 1)) throw CsErr('Метки и goto не поддерживаются', line);
        const d = localDecl(); if (d) return d;
        const e = expr();
        want(';', 'Ожидалось «;» в конце инструкции');
        return { s: 'expr', e, line };
      }
      function localDecl(){
        const s = p, line = pk().line, mods = [];
        while (isId('async') || is('static') || is('unsafe') || is('extern')) { if (isId('async') && (is('(', 1) || is('=>', 1) || is(';', 1) || is('=', 1))) break; mods.push(nx().v); }
        if (!mods.length && isId('var') && is('(', 1)) {
          p += 2; const names = [];
          do names.push(isId('_') ? (p++, null) : name('переменной')); while (eat(','));
          want(')'); want('='); const e = expr(); want(';');
          return { s: 'decon', names, e, line };
        }
        const t0 = pk();
        const ty = type();
        if (ty && pk().k === 'id' && !(t0.k === 'id' && !t0.verb && (t0.v === 'await' || t0.v === 'yield') && ty === t0.v)) {
          if (is('(', 1) || (is('<', 1) && (() => { const q = p; p++; const ok = genericMethodAhead(); p = q; return ok; })())) return { s: 'func', fn: funcRest(ty, mods, line), line };
          if (!mods.length && (is('=', 1) || is(';', 1) || is(',', 1))) return varDecl(ty, line, false);
          if (!mods.length && is('[', 1)) throw CsErr('Массив объявляется так: int[] a = new int[5];', pk().line);
        }
        p = s; return null;
      }
      function varDecl(ty, line, isConst){
        const decls = [];
        do { const nl = pk().line, nm = name('переменной'); let init = null; if (eat('=')) init = is('{') ? arrInit() : expr(); decls.push({ name: nm, init, line: nl }); } while (eat(','));
        want(';', 'Ожидалось «;» после объявления');
        return { s: 'var', ty, decls, isConst, line };
      }
      function forStmt(){
        const line = nx().line; want('(');
        let init = null;
        if (!is(';')) {
          const s = p, ty = type();
          if (ty && pk().k === 'id' && (is('=', 1) || is(',', 1) || is(';', 1))) {
            const decls = [];
            do { const nl = pk().line, nm = name(); let ie = null; if (eat('=')) ie = expr(); decls.push({ name: nm, init: ie, line: nl }); } while (eat(','));
            init = { s: 'var', ty, decls, line };
          } else { p = s; const es = []; do es.push(expr()); while (eat(',')); init = es; }
        }
        want(';', 'Ожидалось «;» в for (…; …; …)');
        const c = is(';') ? null : expr();
        want(';', 'Ожидалось «;» в for (…; …; …)');
        const it = [];
        if (!is(')')) do it.push(expr()); while (eat(','));
        want(')');
        return { s: 'for', init, c, it, body: stmt(), line };
      }
      function foreachStmt(){
        const line = nx().line; want('(');
        let ty = null, nm = null, names = null;
        if (isId('var') && is('(', 1)) { p += 2; names = []; do names.push(isId('_') ? (p++, null) : name()); while (eat(',')); want(')'); }
        else if (is('(')) { p++; names = []; do { if (isId('var') && pk(1).k === 'id') p++; else if (!type()) fail('Ожидался тип'); names.push(name()); } while (eat(',')); want(')'); }
        else { ty = type(); if (!ty) fail('Ожидался тип переменной цикла (например var)'); nm = name('переменной цикла'); }
        if (!eat('in')) fail('Ожидалось «in» в foreach (var x in список)');
        const coll = expr(); want(')');
        return { s: 'foreach', ty: ty === 'var' ? null : ty, name: nm, names, coll, body: stmt(), line };
      }
      function switchStmt(){
        const line = nx().line; want('('); const e = expr(); want(')'); want('{');
        const secs = [];
        while (!eat('}')) {
          const labels = [];
          while (is('case') || (is('default') && is(':', 1))) {
            const ll = pk().line;
            if (eat('default')) { want(':'); labels.push({ pat: null, when: null, line: ll }); continue; }
            p++;
            const pat = pattern();
            let when = null; if (isId('when')) { p++; when = expr(); }
            want(':', 'Ожидалось «:» после case');
            labels.push({ pat, when, line: ll });
          }
          if (!labels.length) fail('Ожидалось case или default');
          const body = [];
          while (!is('case') && !(is('default') && is(':', 1)) && !is('}')) { if (pk().k === 'eof') fail('Не хватает «}» у switch'); body.push(stmt()); }
          secs.push({ labels, body });
        }
        return { s: 'switch', e, secs, line };
      }
      function tryStmt(){
        const line = nx().line, body = block(), catches = [];
        let fin = null;
        while (is('catch')) {
          const cl = nx().line;
          let ty = null, nm = null, when = null;
          if (eat('(')) { ty = type(); if (!ty) fail('Ожидался тип исключения'); if (pk().k === 'id') nm = name(); want(')'); }
          if (isId('when')) { p++; want('('); when = expr(); want(')'); }
          catches.push({ ty, name: nm, when, body: block(), line: cl });
        }
        if (eat('finally')) fin = block();
        if (!catches.length && !fin) fail('После try нужен catch или finally');
        return { s: 'try', body, catches, fin, line };
      }
      function usingStmt(){
        const line = nx().line;
        if (eat('(')) {
          const s = p, ty = type();
          let decl = null, e = null;
          if (ty && pk().k === 'id' && is('=', 1)) { const nl = pk().line, nm = name(); want('='); decl = { s: 'var', ty, decls: [{ name: nm, init: expr(), line: nl }], line }; }
          else { p = s; e = expr(); }
          want(')');
          return { s: 'using', decl, e, body: stmt(), line };
        }
        const ty = type(); if (!ty) fail('Ожидалось объявление после using');
        return varDecl(ty, line, false);
      }

      // ── выражения (приоритеты как в C#) ──
      function expr(){
        if (lambdaAhead()) return lambda();
        const line = pk().line, l = condX(), op = asgOp();
        if (op) { p += op[1]; return { k: 'asg', op: op[0], l, r: expr(), line }; }
        return l;
      }
      function binOpAt(){   // текущий бинарный оператор; > > → >>, > >= → >>=
        const t = pk();
        if (t.k === 'kw' && (t.v === 'is' || t.v === 'as')) return [t.v, 1];
        if (t.k !== 'op') return null;
        if (t.v === '>' && pk(1).k === 'op' && pk(1).s === t.e) {
          const u = pk(1);
          if (u.v === '>') { const w = pk(2); if (w.k === 'op' && w.s === u.e && (w.v === '>' || w.v === '>=')) return [w.v === '>' ? '>>>' : '>>>=', 3]; return ['>>', 2]; }
          if (u.v === '>=') return ['>>=', 2];
        }
        return [t.v, 1];
      }
      function asgOp(){ const b = binOpAt(); return b && ASG.has(b[0]) ? b : null; }
      function condX(){
        const line = pk().line, c = bin(1);
        if (is('?')) { p++; const a = expr(); want(':', 'Ожидалось «:» в выражении усл ? a : b'); return { k: 'cond', c, a, b: expr(), line }; }
        return c;
      }
      function bin(min){
        let l = rangeX();
        for (;;) {
          const b = binOpAt(); if (!b) break;
          const [op, len] = b, pr = PREC[op];
          if (pr === undefined || pr < min) break;
          const line = pk().line;
          if (op === 'is') { p++; l = { k: 'is', e: l, pat: pattern(), line }; continue; }
          if (op === 'as') { p++; const ty = type(); if (!ty) fail('Ожидался тип после as'); l = { k: 'as', e: l, ty, line }; continue; }
          p += len;
          l = { k: 'bin', op, l, r: op === '??' ? bin(pr) : bin(pr + 1), line };
        }
        return l;
      }
      function rangeX(){
        const line = pk().line;
        let a = null;
        if (!is('..')) a = unary();
        if (is('..')) { p++; a = { k: 'range', a, b: startsExpr(pk()) ? unary() : null, line }; }
        while (is('switch')) a = switchX(a);
        if (isId('with') && is('{', 1)) throw CsErr('with-выражения (record) не поддерживаются', line);
        return a;
      }
      function unary(){
        const t = pk(), line = t.line;
        if (t.k === 'op') {
          if (['+', '-', '!', '~', '++', '--', '^'].includes(t.v)) { p++; return { k: 'un', op: t.v, e: unary(), line }; }
          if (t.v === '&' || t.v === '*') throw CsErr('Указатели (& и *) не поддерживаются', line);
          if (t.v === '(') { const c = tryCast(); if (c) return c; }
        }
        if (isId('await') && startsExpr(pk(1)) && !(pk(1).k === 'op' && ['+', '-', '['].includes(pk(1).v))) { p++; return { k: 'await', e: unary(), line }; }
        if (is('throw')) { p++; return { k: 'throw', e: bin(1), line }; }
        return postfix(primary());
      }
      function tryCast(){   // (int)x, (float)(a + b), (Vector3)obj — по правилам C#
        const s = p, line = pk().line;
        p++;
        const kwType = T[p].k === 'kw' || (T[p].k === 'op' && T[p].v === '(');
        const ty = type();
        if (!ty || !is(')')) { p = s; return null; }
        p++;
        const nt = pk();
        let ok;
        if (kwType) ok = startsExpr(nt) && !(nt.k === 'op' && nt.v === '[');
        else ok = nt.k === 'id' || nt.k === 'num' || nt.k === 'str' || nt.k === 'chr' || nt.k === 'istr' || (nt.k === 'op' && (nt.v === '(' || nt.v === '!' || nt.v === '~')) ||
          (nt.k === 'kw' && (['this', 'base', 'new', 'typeof', 'default', 'true', 'false', 'null', 'checked', 'unchecked', 'delegate'].includes(nt.v) || !!PREDEF[nt.v]));
        if (!ok) { p = s; return null; }
        return { k: 'cast', ty, e: unary(), line };
      }
      function primary(){
        const t = pk(), line = t.line;
        if (t.k === 'num') { p++; return { k: 'num', v: t.v, nt: t.nt, line }; }
        if (t.k === 'str') { p++; return { k: 'str', v: t.v, line }; }
        if (t.k === 'chr') { p++; return { k: 'chr', v: t.v, line }; }
        if (t.k === 'istr') { p++; return { k: 'istr', parts: t.v.map(x => typeof x === 'string' ? x : { e: sub(x.toks, x.line), al: x.al ? sub(x.al, x.line) : null, fmt: x.fmt, line: x.line }), line }; }
        if (t.k === 'id') return idX();
        if (t.k === 'op' && t.v === '(') return parenX();
        if (t.k === 'op' && t.v === '[') return collX();
        if (t.k === 'kw') switch (t.v) {
          case 'true': case 'false': p++; return { k: 'bool', v: t.v === 'true', line };
          case 'null': p++; return { k: 'null', line };
          case 'this': p++; return { k: 'this', line };
          case 'base': p++; return { k: 'base', line };
          case 'new': return newX();
          case 'typeof': { p++; want('('); const ty = type(); if (!ty) fail('Ожидался тип'); want(')'); return { k: 'typeof', ty, line }; }
          case 'default': { p++; if (eat('(')) { const ty = type(); if (!ty) fail('Ожидался тип'); want(')'); return { k: 'default', ty, line }; } return { k: 'default', ty: null, line }; }
          case 'checked': case 'unchecked': { p++; want('('); const e = expr(); want(')'); return e; }
          case 'delegate': { p++; let ps = []; if (eat('(')) ps = params(); return { k: 'lambda', params: ps.map(q => ({ name: q.name, ty: q.ty, mod: q.mod })), body: block(), async: false, line }; }
          case 'sizeof': case 'stackalloc': throw CsErr(t.v + ' не поддерживается', line);
          default: if (PREDEF[t.v]) { p++; return { k: 'id', name: t.v, targs: null, line, prim: true }; }
        }
        fail(t.k === 'eof' ? 'Не хватает выражения' : 'Ожидалось выражение');
      }
      function sub(toks, line){   // выражение внутри {…} в $"…"
        const P = parse(toks.concat([])), e = P.exprOnly();
        if (!e) throw CsErr('Пустое выражение в $"…"', line);
        return e;
      }
      function idX(){
        const t = nx(), line = t.line;
        if (!t.verb && t.v === 'nameof' && is('(')) {
          const c = match(p, '(', ')'); if (c < 0) fail('Не хватает «)»');
          let last = ''; for (let j = p; j < c; j++) if (T[j].k === 'id') last = T[j].v;
          p = c + 1; return { k: 'str', v: last, line };
        }
        if (!t.verb && t.v === 'from' && pk().k === 'id' && is('in', 1)) throw CsErr('Запросы LINQ (from … select) не поддерживаются — пиши .Where(x => …).Select(x => …)', line);
        let targs = null;
        if (is('<')) { const a = genericHere(); if (a) targs = a; }
        return { k: 'id', name: t.v, targs, line };
      }
      function parenX(){   // (выражение) или кортеж (a, b) / (int a, var b)
        const line = nx().line, first = tupleItem();
        if (eat(')')) { if (first.name) fail('Ожидалось «,»'); return first.e; }
        const items = [first];
        while (eat(',')) items.push(tupleItem());
        want(')');
        return { k: 'tuple', items, line };
      }
      function tupleItem(){
        if (pk().k === 'id' && is(':', 1)) { const nm = nx().v; p++; return { name: nm, e: expr() }; }
        const s = p, nl = pk().line;
        if (isId('var') && pk(1).k === 'id' && (is(',', 2) || is(')', 2))) { p++; return { e: { k: 'decl', ty: null, name: name(), line: nl } }; }
        const ty = type();
        if (ty && pk().k === 'id' && (is(',', 1) || is(')', 1))) return { e: { k: 'decl', ty, name: name(), line: nl } };
        p = s;
        return { e: expr() };
      }
      function collX(){   // [1, 2, 3] (C# 12)
        const line = nx().line, items = [];
        if (!is(']')) do { if (is(']')) break; if (is('..')) throw CsErr('.. внутри [ ] не поддерживается', line); items.push(expr()); } while (eat(','));
        want(']');
        return { k: 'coll', items, line };
      }
      function newX(){
        const line = nx().line;
        if (is('[')) { p++; let rank = 1; while (eat(',')) rank++; want(']'); if (!is('{')) fail('Ожидалось { … } после new[]'); return { k: 'newarr', ty: null, sizes: null, rank, init: arrInit(), line }; }
        if (is('{')) {   // анонимный объект new { A = 1, B }
          p++; const props = [];
          while (!is('}')) {
            const pl = pk().line; let nm = null;
            if (pk().k === 'id' && is('=', 1)) { nm = nx().v; p++; }
            const e = expr();
            if (!nm) nm = e.k === 'id' ? e.name : e.k === 'mem' ? e.name : null;
            if (!nm) throw CsErr('У свойства анонимного объекта нужно имя: new { Имя = значение }', pl);
            props.push({ name: nm, e });
            if (!eat(',')) break;
          }
          want('}');
          return { k: 'anon', props, line };
        }
        if (is('(')) { p++; const args = argList(); return { k: 'new', ty: null, args, init: is('{') ? objInit() : null, line }; }
        const ty = type();
        if (!ty) fail('Ожидался тип после new');
        if (is('[')) {
          p++; const sizes = []; do sizes.push(expr()); while (eat(',')); want(']');
          let extra = '';
          while (is('[') && (is(']', 1) || is(',', 1))) { p++; let r = 1; while (eat(',')) r++; want(']'); extra += '[' + ','.repeat(r - 1) + ']'; }
          return { k: 'newarr', ty: ty + extra, sizes, rank: sizes.length, init: is('{') ? arrInit() : null, line };
        }
        const m = /^(.*)\[(,*)\]$/.exec(ty);
        if (m) { if (!is('{')) fail('Ожидался размер массива [n] или { … }'); return { k: 'newarr', ty: m[1], sizes: null, rank: m[2].length + 1, init: arrInit(), line }; }
        let args = null;
        if (eat('(')) args = argList();
        const init = is('{') ? objInit() : null;
        if (!args && !init) fail('Ожидалось ( … ) после new ' + ty);
        return { k: 'new', ty, args: args || [], init, line };
      }
      function argList(close = ')'){
        const args = [];
        if (eat(close)) return args;
        do {
          const line = pk().line;
          let nm = null;
          if (pk().k === 'id' && is(':', 1)) { nm = nx().v; p++; }
          let mod = null;
          if (is('ref') || is('out') || is('in')) mod = nx().v;
          let e;
          if (mod === 'out' || mod === 'ref') {
            if (isId('var') && pk(1).k === 'id') { p++; const nl = pk().line; e = { k: 'decl', ty: null, name: name(), line: nl }; }
            else if (isId('_') && (is(',', 1) || is(close, 1))) { p++; e = { k: 'disc', line }; }
            else {
              const s = p, ty = type();
              if (ty && pk().k === 'id' && (is(',', 1) || is(close, 1))) { const nl = pk().line; e = { k: 'decl', ty, name: name(), line: nl }; }
              else { p = s; e = expr(); }
            }
          } else e = expr();
          args.push({ e, mod, name: nm, line });
        } while (eat(','));
        want(close, 'Ожидалось «' + close + '» или «,» между аргументами');
        return args;
      }
      function objInit(){   // { A = 1, B = 2 } | { 1, 2 } | { { "a", 1 } } | { ["a"] = 1 }
        const line = nx().line, items = [];
        let kind = null;
        while (!is('}')) {
          const il = pk().line;
          if (pk().k === 'id' && is('=', 1)) {
            kind = kind || 'obj'; const nm = nx().v; p++;
            if (is('{')) throw CsErr('Вложенные инициализаторы { … } не поддерживаются — пиши Имя = new Тип { … }', il);
            items.push({ name: nm, e: expr(), line: il });
          }
          else if (is('[')) { kind = kind || 'obj'; p++; const ix = argList(']'); want('='); items.push({ index: ix.map(a => a.e), e: expr(), line: il }); }
          else if (is('{')) { kind = kind || 'coll'; p++; const a = []; do a.push(expr()); while (eat(',')); want('}'); items.push({ args: a, line: il }); }
          else { kind = kind || 'coll'; items.push({ args: [expr()], line: il }); }
          if (!eat(',')) break;
        }
        want('}');
        return { kind: kind || 'obj', items, line };
      }
      function arrInit(){   // { 1, 2, { 3, 4 } }
        const line = want('{').line, items = [];
        while (!is('}')) { items.push(is('{') ? arrInit() : expr()); if (!eat(',')) break; }
        want('}');
        return { k: 'arrinit', items, line };
      }
      function postfix(e){
        for (;;) {
          const t = pk(), line = t.line;
          if (t.k !== 'op') break;
          if (t.v === '.' || t.v === '?.') {
            p++; const nt = nx();
            if (nt.k !== 'id' && nt.k !== 'kw') fail('Ожидалось имя после «.»', nt);
            let targs = null; if (is('<')) { const a = genericHere(); if (a) targs = a; }
            e = { k: 'mem', o: e, name: nt.v, cond: t.v === '?.', targs, line };
            continue;
          }
          if (t.v === '?' && is('[', 1) && pk(1).s === t.e) { p += 2; const a = argList(']'); e = { k: 'idx', o: e, args: a.map(x => x.e), cond: true, line }; continue; }
          if (t.v === '(') { p++; e = { k: 'call', f: e, args: argList(), line }; continue; }
          if (t.v === '[') { p++; const a = argList(']'); e = { k: 'idx', o: e, args: a.map(x => x.e), cond: false, line }; continue; }
          if (t.v === '++' || t.v === '--') { p++; e = { k: 'post', op: t.v, e, line }; continue; }
          if (t.v === '!' && pk(1).k === 'op' && ['.', '?.', ')', ']', ';', ',', '}', '['].includes(pk(1).v)) { p++; continue; }   // x! — «точно не null»
          break;
        }
        return e;
      }
      function lambdaAhead(){
        let o = 0;
        if (isId('async') && !is('=>', 1)) o = 1;
        if (is('static', o)) o++;
        const t = pk(o);
        if (t.k === 'id' && is('=>', o + 1)) return true;
        if (t.k === 'op' && t.v === '(') { const c = match(p + o, '([{', ')]}'); return c > 0 && T[c + 1] && T[c + 1].k === 'op' && T[c + 1].v === '=>'; }
        return false;
      }
      function lambda(){
        const line = pk().line;
        let isAsync = false;
        if (isId('async') && !is('=>', 1)) { p++; isAsync = true; }
        eat('static');
        const ps = [];
        if (pk().k === 'id') ps.push({ name: nx().v, ty: null, mod: null });
        else {
          want('(');
          if (!eat(')')) {
            do {
              let mod = null; if (is('ref') || is('out') || is('in')) mod = nx().v;
              if (pk().k === 'id' && (is(',', 1) || is(')', 1))) ps.push({ name: nx().v, ty: null, mod });
              else { const ty = type(); if (!ty) fail('Ожидался параметр'); ps.push({ name: name('параметра'), ty, mod }); }
            } while (eat(','));
            want(')');
          }
        }
        want('=>');
        return { k: 'lambda', params: ps, body: is('{') ? block() : expr(), async: isAsync, line };
      }
      function switchX(e){   // x switch { шаблон => значение, … }
        const line = nx().line; want('{');
        const arms = [];
        while (!is('}')) {
          const al = pk().line, pat = pattern();
          let when = null; if (isId('when')) { p++; when = expr(); }
          want('=>', 'Ожидалось «=>» в switch-выражении');
          arms.push({ pat, when, e: expr(), line: al });
          if (!eat(',')) break;
        }
        want('}');
        return { k: 'swx', e, arms, line };
      }
      // ── шаблоны: x is int n, case > 5 and < 10, case State.Idle, not null, _ ──
      const NOTNAME = new Set(['when', 'and', 'or', 'not']);
      function pattern(){ let a = patAnd(); while (isId('or')) { p++; a = { p: 'or', a, b: patAnd() }; } return a; }
      function patAnd(){ let a = patNot(); while (isId('and')) { p++; a = { p: 'and', a, b: patNot() }; } return a; }
      function patNot(){ if (isId('not')) { p++; return { p: 'not', a: patNot() }; } return patPrim(); }
      function desig(){ const t = pk(); if (t.k === 'id' && !t.verb && t.v === '_') { p++; return null; } if (t.k === 'id' && !(NOTNAME.has(t.v) && !t.verb)) return nx().v; return null; }
      function patPrim(){
        const t = pk(), line = t.line;
        if (is('(')) { p++; const a = pattern(); want(')'); return a; }
        if (is('{')) throw CsErr('Шаблоны свойств { … } не поддерживаются', line);
        if (is('null')) { p++; return { p: 'null' }; }
        if (isId('_') && !is('.', 1)) { p++; return { p: 'disc' }; }
        if (isId('var') && pk(1).k === 'id') { p++; return { p: 'var', name: name() }; }
        if (t.k === 'op' && ['<', '>', '<=', '>='].includes(t.v)) { p++; return { p: 'rel', op: t.v, e: bin(9), line }; }
        if (t.k === 'kw' && PREDEF[t.v] && !is('.', 1)) { const ty = type({ noNull: true }); return { p: 'type', ty, name: desig(), line }; }
        if (t.k === 'id') {
          const s = p, ty = type({ noNull: true });
          if (ty) { const u = pk(); if (u.k === 'id' && !(NOTNAME.has(u.v) && !u.verb)) return { p: 'type', ty, name: desig(), line }; }
          p = s;
        }
        const e = bin(9);
        if (e.k === 'id' || e.k === 'mem') return { p: 'name', e, line };
        return { p: 'const', e, line };
      }

      return { unit, exprOnly(){ const e = expr(); if (pk().k !== 'eof') fail('Лишнее в выражении'); return e; } };
    }

    // ═══ 3. Генератор JS. Типы — строки C#: 'int' 'float' 'string' 'List<int>' 'int[]' 'Vector3' … (null — неизвестно) ═══
    const JSRES = new Set(('arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally ' +
      'for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true ' +
      'try typeof var void while with yield undefined NaN Infinity').split(' '));
    const jsName = n => JSRES.has(n) ? n + '$' : n;
    const Fl = 'float', In = 'int', St = 'string', Bo = 'bool', V3 = 'Vector3', Co = 'Color';
    // Библиотека для генератора: t — тип значения; s — статические члены (тип или 'тип()' — метод); f — функция; type — это тип (можно new)
    // особые результаты: num() — int, если все аргументы int (иначе float), num2() — то же с double, rng() — Random.Range, rnd() — random(a, b)
    const NUMS = (t, extra) => Object.assign({ Parse: t + '()', TryParse: 'bool()', MaxValue: t, MinValue: t }, extra);
    const FLTS = t => NUMS(t, { Epsilon: t, PositiveInfinity: t, NegativeInfinity: t, NaN: t, IsNaN: 'bool()', IsInfinity: 'bool()', IsPositiveInfinity: 'bool()', IsNegativeInfinity: 'bool()', IsFinite: 'bool()' });
    const MATH = { Abs: 'num2()', Min: 'num2()', Max: 'num2()', Clamp: 'num2()', Sign: 'int()', Floor: 'double()', Ceiling: 'double()', Round: 'double()', Truncate: 'double()',
      Sqrt: 'double()', Pow: 'double()', Exp: 'double()', Log: 'double()', Log10: 'double()', Log2: 'double()', Sin: 'double()', Cos: 'double()', Tan: 'double()',
      Asin: 'double()', Acos: 'double()', Atan: 'double()', Atan2: 'double()', Cbrt: 'double()', PI: 'double', E: 'double', Tau: 'double' };
    const API = {
      script: { t: 'Script' }, Parent: { t: 'Part' }, game: { t: 'Game' }, workspace: { t: 'Workspace' }, Enum: { t: null },
      Instance: { type: 1, s: { new: 'Part()' } },
      TweenService: { t: 'TweenService' }, RunService: { t: 'RunService' }, Players: { t: 'Players' }, Debris: { t: 'Debris' }, gui: { t: null }, sound: { t: null },
      TweenInfo: { type: 1, s: { new: 'TweenInfo()' } },
      task: { type: 1, s: { wait: 'Task<float>()', spawn: 'void()', delay: 'void()' } },
      wait: { f: 'Task<float>' }, print: { f: 'void', pr: 1 }, warn: { f: 'void', pr: 1 }, random: { f: 'rnd' },
      Vector3: { type: 1, s: { zero: V3, one: V3, up: V3, down: V3, forward: V3, back: V3, left: V3, right: V3, positiveInfinity: V3, negativeInfinity: V3, new: 'Vector3()',
        Distance: 'float()', Dot: 'float()', Angle: 'float()', SignedAngle: 'float()', Magnitude: 'float()', SqrMagnitude: 'float()', Lerp: 'Vector3()', LerpUnclamped: 'Vector3()',
        Slerp: 'Vector3()', Cross: 'Vector3()', Normalize: 'Vector3()', MoveTowards: 'Vector3()', Scale: 'Vector3()', ClampMagnitude: 'Vector3()', Max: 'Vector3()', Min: 'Vector3()',
        Project: 'Vector3()', ProjectOnPlane: 'Vector3()', Reflect: 'Vector3()' } },
      Color3: { type: 1, s: { new: 'Color()', fromRGB: 'Color()', fromHSV: 'Color()', fromHex: 'Color()' } },
      Color: { type: 1, s: { red: Co, green: Co, blue: Co, white: Co, black: Co, yellow: Co, cyan: Co, magenta: Co, gray: Co, grey: Co, clear: Co, orange: Co,
        Lerp: 'Color()', LerpUnclamped: 'Color()', HSVToRGB: 'Color()', new: 'Color()' } },
      Color32: { type: 1, s: { new: 'Color()', Lerp: 'Color()' } },
      Mathf: { type: 1, s: { PI: Fl, Infinity: Fl, NegativeInfinity: Fl, Epsilon: Fl, Deg2Rad: Fl, Rad2Deg: Fl,
        Sin: 'float()', Cos: 'float()', Tan: 'float()', Asin: 'float()', Acos: 'float()', Atan: 'float()', Atan2: 'float()', Sqrt: 'float()', Pow: 'float()', Exp: 'float()',
        Log: 'float()', Log10: 'float()', Floor: 'float()', Ceil: 'float()', Round: 'float()', FloorToInt: 'int()', CeilToInt: 'int()', RoundToInt: 'int()',
        Abs: 'num()', Min: 'num()', Max: 'num()', Clamp: 'num()', Sign: 'float()', Clamp01: 'float()', Lerp: 'float()', LerpUnclamped: 'float()', InverseLerp: 'float()',
        MoveTowards: 'float()', MoveTowardsAngle: 'float()', PingPong: 'float()', Repeat: 'float()', DeltaAngle: 'float()', LerpAngle: 'float()', SmoothStep: 'float()',
        Approximately: 'bool()', PerlinNoise: 'float()', IsPowerOfTwo: 'bool()', ClosestPowerOfTwo: 'int()', NextPowerOfTwo: 'int()' } },
      Math: { type: 1, s: MATH }, MathF: { type: 1, s: MATH },
      Debug: { type: 1, s: { Log: 'void()', LogWarning: 'void()', LogError: 'void()', LogFormat: 'void()', LogWarningFormat: 'void()', LogErrorFormat: 'void()',
        LogException: 'void()', Assert: 'void()', DrawLine: 'void()', DrawRay: 'void()', Break: 'void()' } },
      Console: { type: 1, s: { WriteLine: 'void()', Write: 'void()' } },
      Random: { type: 1, s: { Range: 'rng()', value: Fl, insideUnitSphere: V3, onUnitSphere: V3, insideUnitCircle: V3, rotation: V3, ColorHSV: 'Color()', InitState: 'void()' } },
      Time: { type: 1, s: { time: Fl, deltaTime: Fl, fixedDeltaTime: Fl, smoothDeltaTime: Fl, unscaledDeltaTime: Fl, unscaledTime: Fl, timeSinceLevelLoad: Fl,
        realtimeSinceStartup: Fl, fixedTime: Fl, frameCount: In, timeScale: Fl } },
      Quaternion: { type: 1, s: { identity: V3, Euler: 'Vector3()', LookRotation: 'Vector3()' } },
      Space: { type: 1, s: { World: In, Self: In } },
      PlayerPrefs: { type: 1, s: { SetInt: 'void()', SetFloat: 'void()', SetString: 'void()', GetInt: 'int()', GetFloat: 'float()', GetString: 'string()', HasKey: 'bool()',
        DeleteKey: 'void()', DeleteAll: 'void()', Save: 'void()' } },
      GameObject: { type: 1, s: { Find: 'Part()' } },
      StringSplitOptions: { type: 1, s: { None: In, RemoveEmptyEntries: In, TrimEntries: In } },
      MidpointRounding: { type: 1, s: { ToEven: 'MidpointRounding', AwayFromZero: 'MidpointRounding' } },
      StringComparison: { type: 1, s: { Ordinal: In, OrdinalIgnoreCase: In, CurrentCulture: In, CurrentCultureIgnoreCase: In, InvariantCulture: In, InvariantCultureIgnoreCase: In } },
      Array: { type: 1, s: { IndexOf: 'int()', LastIndexOf: 'int()', Sort: 'void()', Reverse: 'void()', Resize: 'void()', Copy: 'void()', Clear: 'void()', Fill: 'void()',
        Exists: 'bool()', Find: 'elem()', FindIndex: 'int()', FindAll: 'arg0()', TrueForAll: 'bool()', ForEach: 'void()', Empty: 'arg0()' } },
      Enumerable: { type: 1, s: { Range: 'List<int>()', Repeat: 'List<object>()', Empty: 'List<object>()' } },
      Convert: { type: 1, s: { ToInt32: 'int()', ToInt64: 'int()', ToInt16: 'int()', ToByte: 'int()', ToSingle: 'float()', ToDouble: 'double()', ToDecimal: 'decimal()',
        ToString: 'string()', ToBoolean: 'bool()', ToChar: 'char()' } },
      string: { type: 1, s: { Format: 'string()', Join: 'string()', Concat: 'string()', IsNullOrEmpty: 'bool()', IsNullOrWhiteSpace: 'bool()', Equals: 'bool()', Compare: 'int()',
        CompareOrdinal: 'int()', Empty: St } },
      int: { type: 1, s: NUMS(In) }, long: { type: 1, s: NUMS(In) }, short: { type: 1, s: NUMS(In) }, byte: { type: 1, s: NUMS(In) }, sbyte: { type: 1, s: NUMS(In) },
      uint: { type: 1, s: NUMS(In) }, ulong: { type: 1, s: NUMS(In) }, ushort: { type: 1, s: NUMS(In) },
      float: { type: 1, s: FLTS(Fl) }, double: { type: 1, s: FLTS('double') }, decimal: { type: 1, s: FLTS('decimal') },
      bool: { type: 1, s: { Parse: 'bool()', TryParse: 'bool()', TrueString: St, FalseString: St } },
      char: { type: 1, s: { IsDigit: 'bool()', IsLetter: 'bool()', IsLetterOrDigit: 'bool()', IsUpper: 'bool()', IsLower: 'bool()', IsWhiteSpace: 'bool()', IsPunctuation: 'bool()',
        IsNumber: 'bool()', IsSymbol: 'bool()', IsControl: 'bool()', IsSeparator: 'bool()', ToUpper: 'char()', ToLower: 'char()', GetNumericValue: 'double()', MaxValue: 'char', MinValue: 'char' } },
      object: { type: 1, s: { Destroy: 'void()', Instantiate: 'Part()', Equals: 'bool()', ReferenceEquals: 'bool()', FindObjectOfType: 'gen()', FindObjectsOfType: 'gen[]()' } },
      Task: { type: 1, s: { Delay: 'Task()', Yield: 'Task()', WhenAll: 'Task()', WhenAny: 'Task()', Run: 'Task()', CompletedTask: 'Task', FromResult: 'Task()' } },
      StartCoroutine: { f: 'Coroutine' }, StopCoroutine: { f: 'void' }, StopAllCoroutines: { f: 'void' }, Destroy: { f: 'void' }, Instantiate: { f: 'Part' },
      FindObjectOfType: { f: 'gen' }, FindObjectsOfType: { f: 'gen[]' },
    };
    for (const n of ['List', 'Dictionary', 'HashSet', 'Queue', 'Stack', 'KeyValuePair', 'StringBuilder', 'WaitForSeconds', 'WaitForSecondsRealtime', 'WaitUntil', 'WaitWhile',
      'WaitForEndOfFrame', 'WaitForFixedUpdate', 'Exception', 'ArgumentException', 'ArgumentNullException', 'ArgumentOutOfRangeException', 'InvalidOperationException',
      'NullReferenceException', 'IndexOutOfRangeException', 'KeyNotFoundException', 'DivideByZeroException', 'FormatException', 'NotImplementedException',
      'NotSupportedException', 'OverflowException', 'InvalidCastException', 'TimeoutException']) API[n] = API[n] || { type: 1, s: {} };
    API.KeyValuePair.s = { Create: 'KeyValuePair()' };
    const ALIAS = { Int32: 'int', Int64: 'long', Int16: 'short', Byte: 'byte', SByte: 'sbyte', UInt32: 'uint', UInt64: 'ulong', UInt16: 'ushort', Single: 'float', Double: 'double',
      Decimal: 'decimal', Boolean: 'bool', Char: 'char', String: 'string', Object: 'object', MonoBehaviour: 'Script' };
    const EXC = new Set(Object.keys(API).filter(n => /Exception$/.test(n)));
    const NS = new Set(['System', 'UnityEngine', 'Unity', 'Collections', 'Generic', 'Linq', 'Text', 'Threading', 'Tasks', 'TMPro', 'Roblox', 'D37']);
    // только как типы (объявления, параметры): объекты мира, делегаты, интерфейсы коллекций
    const TYPES = new Set(['Action', 'Func', 'Predicate', 'Comparison', 'EventHandler', 'UnityAction', 'IEnumerator', 'IEnumerable', 'ICollection', 'IList', 'IReadOnlyList',
      'IReadOnlyCollection', 'IDictionary', 'IReadOnlyDictionary', 'ISet', 'Coroutine', 'Part', 'BasePart', 'MeshPart', 'Player', 'Humanoid', 'Model', 'Folder', 'Workspace',
      'Instance', 'Tween', 'Transform', 'GameObject', 'Collider', 'Collision', 'Script', 'Behaviour', 'Component', 'object', 'Signal', 'RBXScriptSignal', 'RBXScriptConnection',
      'Connection', 'Task', 'ValueTask', 'IComparable', 'IComparer', 'IEquatable', 'IDisposable', 'Vector3', 'Color', 'Color32', 'Color3', 'Quaternion', 'KeyValuePair',
      'Prompt', 'TweenInfo', 'Players', 'RunService', 'Game', 'Debris', 'SpawnLocation', 'PointLight', 'WedgePart', 'Random', 'StringBuilder', 'List', 'Dictionary', 'HashSet',
      'Queue', 'Stack', 'Type', 'Delegate', 'TweenService', 'Space', 'StringSplitOptions', 'MidpointRounding', 'StringComparison', ...EXC]);
    const NOPE = {
      Rigidbody: 'Rigidbody в Студии 3D нет: деталь падает сама, если Anchored = false', Rigidbody2D: 'двумерной физики нет',
      Vector2: 'Vector2 нет — используй Vector3 (z = 0)', Vector4: 'Vector4 нет — используй Vector3',
      Input: 'клавиатура и мышь скриптам недоступны: используй Prompt("…").Triggered, Clicked или Touched',
      KeyCode: 'клавиатура скриптам недоступна: используй Prompt("…").Triggered', AudioSource: 'звук — sound.play("coin")', AudioClip: 'звук — sound.play("coin")',
      Animator: 'анимаций нет — двигай детали TweenService или в Update', Animation: 'анимаций нет — двигай детали TweenService или в Update',
      Camera: 'камерой управляет игра', Light: 'свет — Instance.new("PointLight", деталь)',
      Text: 'надписи — gui.text("ключ", "текст") или gui.message("текст", 3)', TextMeshProUGUI: 'надписи — gui.text("ключ", "текст")', TMP_Text: 'надписи — gui.text("ключ", "текст")',
      Canvas: 'интерфейс — gui.text / gui.message', Image: 'интерфейс — gui.text / gui.message', Button: 'кнопка — деталь со скриптом Prompt("Нажать").Triggered',
      NavMeshAgent: 'NavMesh нет — двигай детали сам (TweenService, Update)', CharacterController: 'игроком управляет игра: player.Teleport, player.Humanoid.WalkSpeed',
      Physics: 'Physics нет: касания — Touched / OnTouched', Physics2D: 'двумерной физики нет', Material: 'материал детали — строка: part.Material = "neon"',
      Renderer: 'цвет детали — part.Color = Color.red', MeshRenderer: 'цвет детали — part.Color = Color.red', SceneManager: 'сцен нет — один мир',
      Resources: 'Resources.Load нет — клонируй детали: Instantiate(деталь)', Thread: 'потоков нет — используй async/await или корутины',
      File: 'файлов нет (песочница)', HttpClient: 'сети нет (песочница)', UnityWebRequest: 'сети нет (песочница)', WWW: 'сети нет (песочница)',
      Application: 'Application нет', Screen: 'Screen нет — экраном управляет игра', Cursor: 'курсором управляет игра', Vector3Int: 'Vector3Int нет — используй Vector3',
    };
    // тип члена у объекта неизвестного типа (детали, игроки — объекты песочницы)
    const MT = { Position: V3, Size: V3, Orientation: V3, position: V3, localPosition: V3, localScale: V3, lossyScale: V3, eulerAngles: V3, localEulerAngles: V3, rotation: V3,
      forward: V3, right: V3, up: V3, normalized: V3, Unit: V3, X: Fl, Y: Fl, Z: Fl, x: Fl, y: Fl, z: Fl, Magnitude: Fl, magnitude: Fl, sqrMagnitude: Fl,
      Transparency: Fl, Health: Fl, MaxHealth: Fl, WalkSpeed: Fl, JumpPower: Fl, Range: Fl, Brightness: Fl, r: Fl, g: Fl, b: Fl, a: Fl,
      Name: St, name: St, Text: St, ClassName: St, DisplayName: St, Message: St, tag: St, Material: St, UserId: St, StackTrace: St,
      Count: In, Length: In, childCount: In, CanCollide: Bo, Anchored: Bo, CastShadow: Bo, enabled: Bo, activeSelf: Bo, activeInHierarchy: Bo, Connected: Bo,
      Color: Co, color: Co, Parent: 'Part', Humanoid: 'Humanoid', transform: 'Transform', gameObject: 'GameObject', Character: 'Character', Triggered: 'Signal',
      Touched: 'Signal', TouchEnded: 'Signal', Clicked: 'Signal', Heartbeat: 'Signal', PlayerAdded: 'Signal', PlayerRemoving: 'Signal', Died: 'Signal', Completed: 'Signal',
      LocalPlayer: 'Player', Workspace: 'Workspace' };
    // тип результата метода у объекта неизвестного типа
    const MR = { ToString: St, ToUpper: St, ToLower: St, ToUpperInvariant: St, ToLowerInvariant: St, Trim: St, TrimStart: St, TrimEnd: St, Substring: St, Replace: St,
      Insert: St, PadLeft: St, PadRight: St, Contains: Bo, StartsWith: Bo, EndsWith: Bo, Equals: Bo, ContainsKey: Bo, ContainsValue: Bo, TryGetValue: Bo, Exists: Bo,
      Any: Bo, All: Bo, IsA: Bo, CompareTag: Bo, TrueForAll: Bo, TryAdd: Bo, IndexOf: In, LastIndexOf: In, FindIndex: In, CompareTo: In, RemoveAll: In, GetLength: In,
      Split: 'string[]', ToCharArray: 'char[]', GetChildren: 'List<Part>', GetDescendants: 'List<Part>', FindFirstChild: 'Part', WaitForChild: 'Part', Clone: 'Part',
      GetPlayers: 'List<Player>', Prompt: 'Prompt', Create: 'Tween', Play: 'Tween', Connect: 'Connection', GetAttribute: null, Wait: 'Task' };
    const SIG = new Set(['Touched', 'TouchEnded', 'Clicked', 'MouseClick', 'Heartbeat', 'Stepped', 'RenderStepped', 'PlayerAdded', 'PlayerRemoving', 'Died', 'Completed',
      'Triggered', 'Changed', 'ChildAdded', 'ChildRemoved', 'CharacterAdded', 'Activated', 'MouseButton1Click']);
    // члены базового класса Script / MonoBehaviour
    const SM = { Parent: 'Part', script: 'Script', transform: 'Transform', gameObject: 'GameObject', name: St, enabled: Bo, tag: St,
      StartCoroutine: 'Coroutine()', StopCoroutine: 'void()', StopAllCoroutines: 'void()', Invoke: 'void()', InvokeRepeating: 'void()', CancelInvoke: 'void()',
      IsInvoking: 'bool()', Destroy: 'void()', Instantiate: 'Part()', print: 'void()', GetComponent: 'gen()', GetComponents: 'gen[]()', FindObjectOfType: 'gen()',
      FindObjectsOfType: 'gen[]()', CompareTag: 'bool()' };
    const MSGS = ['Awake', 'OnEnable', 'Start', 'Update', 'LateUpdate', 'FixedUpdate', 'OnDisable', 'OnDestroy', 'OnTouched', 'OnTouchEnded', 'OnTriggerEnter', 'OnTriggerExit',
      'OnCollisionEnter', 'OnCollisionExit', 'OnClicked', 'OnMouseDown', 'OnPlayerAdded', 'OnPlayerRemoving'];
    const OPN = { '+': 'op_Addition', '-': 'op_Subtraction', '*': 'op_Multiply', '/': 'op_Division', '%': 'op_Modulus', '==': 'op_Equality', '!=': 'op_Inequality',
      '<': 'op_LessThan', '>': 'op_GreaterThan', '<=': 'op_LessThanOrEqual', '>=': 'op_GreaterThanOrEqual', '&': 'op_BitwiseAnd', '|': 'op_BitwiseOr', '^': 'op_ExclusiveOr',
      'u-': 'op_UnaryNegation', 'u+': 'op_UnaryPlus', 'u!': 'op_LogicalNot', 'u++': 'op_Increment', 'u--': 'op_Decrement', '<<': 'op_LeftShift', '>>': 'op_RightShift' };
    // ── типы-строки ──
    const bare = t => t ? t.replace(/\?$/, '') : t;
    const splitTop = s => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '<' || c === '(' || c === '[') d++; else if (c === '>' || c === ')' || c === ']') d--; if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };
    const genName = t => (bare(t) || '').replace(/<.*$/, '');
    const genArgs = t => { const m = /^[^<(]*<(.*)>$/.exec(bare(t) || ''); return m ? splitTop(m[1]) : []; };
    const isArrT = t => /\[,*\]$/.test(bare(t) || '');
    const rankOf = t => { const m = /\[(,*)\]$/.exec(bare(t) || ''); return m ? m[1].length + 1 : 0; };
    const LISTS = new Set(['List', 'IList', 'IReadOnlyList', 'ICollection', 'IReadOnlyCollection', 'IEnumerable', 'HashSet', 'ISet', 'Queue', 'Stack', 'IEnumerator']);
    const DICTS = new Set(['Dictionary', 'IDictionary', 'IReadOnlyDictionary', 'SortedDictionary']);
    const isListT = t => isArrT(t) || (LISTS.has(genName(t)) && genName(t) !== 'HashSet' && genName(t) !== 'Queue' && genName(t) !== 'Stack');
    const isDictT = t => DICTS.has(genName(t));
    const isTupleT = t => /^\(.*\)$/.test(bare(t) || '');
    const tupleEls = t => splitTop(bare(t).slice(1, -1)).map(x => { const i = x.lastIndexOf(' '); return i > 0 ? { t: x.slice(0, i), n: x.slice(i + 1) } : { t: x, n: null }; });
    const elemT = t => {
      t = bare(t); if (!t) return null;
      if (isArrT(t)) return t.replace(/\[,*\]$/, '');
      if (t === 'string') return 'char';
      if (LISTS.has(genName(t))) return genArgs(t)[0] || null;
      if (isDictT(t)) return 'KeyValuePair<' + genArgs(t).join(',') + '>';
      return null;
    };
    const isDelT = t => /^(Action|Func|Predicate|Comparison|EventHandler|UnityAction|delegate)(<|$)/.test(bare(t) || '');
    const delRet = t => { t = bare(t); if (!t) return null; if (genName(t) === 'Func') { const a = genArgs(t); return a[a.length - 1]; } if (genName(t) === 'Predicate') return Bo; if (genName(t) === 'Comparison') return In; return null; };
    const delParams = t => { t = bare(t); if (!t) return null; const g = genName(t), a = genArgs(t); if (g === 'Action' || g === 'UnityAction') return a; if (g === 'Func') return a.slice(0, -1); if (g === 'Predicate') return a; if (g === 'Comparison') return [a[0], a[0]]; return null; };
    const taskRes = t => { t = bare(t); if (!t) return null; if (/^(Task|ValueTask)<(.*)>$/.test(t)) return genArgs(t)[0]; if (t === 'Task' || t === 'ValueTask') return 'void'; return null; };
    const sigRet = s => s && s.endsWith('()') ? s.slice(0, -2) : null;

    let SEQ = 0;   // номер переведённого скрипта (sourceURL d37cs-N.js)
    function gen(U, XC){
      const CL = new Map();       // свои типы: имя → { d, name, js, kind, base, script, mem: Map, ctors, ops, outer, … }
      const USED = new Set();     // имена библиотеки, нужные коду (const { … } = $.A)
      const TPS = new Set();      // имена параметров generic-типов и методов (T, K, V …)
      const XW = new Map();       // классы других скриптов этого запуска: обёртки, в коде — ($.X("Имя"))
      const imp = o => { let w = XW.get(o); if (w) return w; w = Object.create(o); w.js = '($.X(' + JSON.stringify(o.name) + '))'; w.ext = true; XW.set(o, w); w.baseC = o.baseC ? imp(o.baseC) : null; return w; };
      const clsOf = n => CL.get(n) || (XC && XC.has(n) ? imp(XC.get(n)) : null);
      const baseOf = b => b.baseC || null;
      let SC = null, FN = null, TMP = 0, PEND = null, BRK = [];
      const isEnumT = t => { const c = clsOf(bare(t)); return !!c && c.kind === 'enum'; };
      const isStructT = t => { const c = clsOf(genName(t)); return !!c && c.kind === 'struct'; };
      const isIntT = t => { t = bare(t); return t === 'int' || isEnumT(t); };
      const isNumT = t => { t = bare(t); return t === 'int' || t === 'float' || t === 'double' || t === 'decimal' || isEnumT(t); };
      const isPrimT = t => { t = bare(t); return isNumT(t) || t === 'string' || t === 'char' || t === 'bool'; };
      const numT = (a, b) => { a = bare(a); b = bare(b); if ((isIntT(a) || a === 'char') && (isIntT(b) || b === 'char')) return 'int'; if (a === 'double' || b === 'double' || a === 'decimal' || b === 'decimal') return 'double'; return 'float'; };
      const userCls = t => { const c = t && clsOf(genName(t)); return c && c.kind !== 'enum' && c.kind !== 'delegate' ? c : null; };
      const tmp = () => { const n = '$t' + (++TMP); PEND && PEND.push(n); return n; };
      const pureCode = c => /^[\w$]+(\.[\w$]+)*$/.test(c) || /^-?\d+(\.\d+)?$/.test(c) || /^"([^"\\]|\\.)*"$/.test(c);
      const once = (c, pre) => { if (pureCode(c)) return c; const t = tmp(); pre.push(t + ' = ' + c); return t; };
      const seq = (pre, c) => pre.length ? '(' + pre.concat([c]).join(', ') + ')' : c;

      // ── проверка имён типов (int, List<Foo>, Vector3[] …) ──
      function checkType(t, line){
        if (!t) return;
        t = bare(t);
        if (isTupleT(t)) { for (const e of tupleEls(t)) checkType(e.t, line); return; }
        if (isArrT(t)) return checkType(t.replace(/\[,*\]$/, ''), line);
        for (const a of genArgs(t)) if (a) checkType(a, line);
        const n = genName(t);
        if (!n || ['int', 'float', 'double', 'decimal', 'string', 'char', 'bool', 'object', 'void', 'var'].includes(n)) return;
        if (clsOf(n) || TYPES.has(n) || API[n] && API[n].type || ALIAS[n]) return;
        for (let f = FN; f; f = f.up) if (f.tps && f.tps.includes(n)) return;
        if (TPS.has(n)) return;
        if (NOPE[n]) throw CsErr(n + ': ' + NOPE[n], line);
        throw Object.assign(CsErr('Тип «' + n + '» не найден', line), { unk: true });
      }

      // ── области видимости ──
      const push = () => { SC = { v: new Map(), up: SC, fn: FN }; };
      const pop = () => { SC = SC.up; };
      function declare(name, type, line, extra){
        for (let s = SC; s && s.fn === FN; s = s.up) if (s.v.has(name)) throw CsErr('Переменная «' + name + '» уже объявлена', line);
        if (FN && FN.params && FN.params.has(name) && SC.fn === FN && !extra?.param) throw CsErr('Переменная «' + name + '» уже есть (это параметр)', line);
        const js = jsName(name);
        const v = Object.assign({ type: type || null, js, name }, extra);
        SC.v.set(name, v);
        return v;
      }
      function lookup(name){ for (let s = SC; s; s = s.up) { const v = s.v.get(name); if (v) return v; } return null; }
      function selfRef(line){
        if (!FN || !FN.self) throw CsErr('this здесь нельзя (код вне класса или static-метод)', line);
        if (FN.self === '$self') FN.root.needSelf = true;
        return FN.self;
      }
      // член своего класса / базовых / внешних
      function findMem(cls, name){
        for (let b = cls, n = 0; b && n < 50; b = baseOf(b), n++) { const m = b.mem.get(name); if (m) return { owner: b, m }; }
        return null;
      }
      function nestedType(cls, name){ for (let c = cls; c; c = c.outer) { const n = CL.get(name); if (n && n.outer === c) return n; } return null; }
      function memRef(owner, m, name, line, recv){
        if (m.kind === 'enumv') return { c: owner.js + '.' + m.js, t: owner.name, pure: true };
        if (m.static) {
          const c = owner.js + '.' + m.js;
          if (m.kind === 'method') return { c, t: 'delegate', mg: { owner, m, recv: owner.js, st: true } };
          return { c, t: m.type, lv: !m.isConst, pure: true, mem: m };
        }
        const self = recv || selfRef(line);
        if (m.kind === 'method') return { c: '$.mg(' + self + ', ' + JSON.stringify(m.js) + ')', t: 'delegate', mg: { owner, m, recv: self } };
        return { c: self + '.' + m.js, t: m.type, lv: true, pure: pureCode(self), mem: m };
      }
      function rid(name, line){
        const v = lookup(name);
        if (v) {
          if (v.kind === 'func') return { c: v.js, t: 'delegate', mg: { local: v }, pure: true };
          return { c: v.ref ? v.js + '.v' : v.js, t: v.type, lv: !v.isConst, pure: true, loc: v };
        }
        if (FN && FN.cls) {
          for (let c = FN.cls; c; c = c.outer) {
            const f = findMem(c, name);
            if (f) {
              if (c !== FN.cls && !f.m.static) throw CsErr('«' + name + '» — член внешнего класса ' + c.name + ': без объекта доступен только static', line);
              if (!f.m.static && FN.isStatic) throw CsErr('«' + name + '» нельзя использовать в static-методе (нужен объект)', line);
              return memRef(f.owner, f.m, name, line);
            }
            if (c === FN.cls && scriptCls(c) && Object.prototype.hasOwnProperty.call(SM, name)) {
              if (FN.isStatic) throw CsErr('«' + name + '» нельзя использовать в static-методе', line);
              const self = selfRef(line), sig = SM[name];
              if (sig.endsWith('()')) return { c: '$.mg(' + self + ', ' + JSON.stringify(name) + ')', t: 'delegate', mg: { script: name, recv: self } };
              return { c: self + '.' + name, t: sig, lv: name === 'enabled' || name === 'name' || name === 'tag', pure: true };
            }
            const nt = nestedType(c, name); if (nt) return { ty: nt, c: nt.js, t: nt.name };
          }
        }
        { const c = clsOf(name); if (c) return { ty: c, c: c.js, t: name }; }
        if (NOPE[name]) throw CsErr(name + ': ' + NOPE[name], line);
        const an = ALIAS[name] || name;
        if (an !== 'Script' && Object.prototype.hasOwnProperty.call(API, an)) { USED.add(an); const a = API[an]; return { c: an, t: a.t === undefined ? null : a.t, api: an, pure: true, ty: a.type ? { api: an } : null }; }
        if (NS.has(name)) return { ns: name };
        throw Object.assign(CsErr('Имя «' + name + '» не найдено (нет такой переменной, метода или класса)', line), { unk: true });
      }
      const scriptCls = c => { for (let b = c, n = 0; b && n < 50; b = baseOf(b), n++) if (b.script) return true; return false; };

      // ── выражения: результат { c: код, t: тип, lv, pure, mg (группа методов), ty (ссылка на тип), cond (цепочка ?.) } ──
      const recvCode = c => /^[\d.]/.test(c) ? '(' + c + ')' : c;
      function fin(R){
        if (!R.cond) return R;
        let c = R.c;
        for (let i = R.cond.length - 1; i >= 0; i--) c = '$.nn(' + R.cond[i].test + ', ' + R.cond[i].tmp + ' => ' + c + ')';
        return { c, t: R.t };
      }
      // выражение на другой строке, чем его инструкция (многострочные вызовы, лямбды, цепочки) — своя метка строки
      const NOMARK = new Set(['num', 'str', 'chr', 'bool', 'null', 'id', 'this', 'base']);
      let STL = 0;
      const ex = (n, want) => { const R = fin(raw(n, want)); if (n.line && n.line !== STL && !NOMARK.has(n.k) && !R.ty && !R.ns) R.c = mark(n.line) + R.c; return R; };
      const LEADRE = new RegExp('^(?:' + MK + '[0-9]+' + MK2 + ')+');
      const lead = (kw, c) => { const m = LEADRE.exec(c); return m ? m[0] + kw + c.slice(m[0].length) : kw + c; };   // метки — перед return/throw/yield (перевод строки после них — это конец инструкции в JS)
      function link(R, cond, build){   // a?.b.c → $.nn(a, $r1 => $r1.b.c)
        if (!cond) { const r = build(R.c); if (R.cond) r.cond = R.cond; return r; }
        const t = '$r' + (++TMP), r = build(t);
        r.cond = (R.cond || []).concat([{ test: R.c, tmp: t }]);
        r.pure = false;
        return r;
      }
      function strOf(R){   // значение → строка как в C#: true → True, float → 7 знаков, null → ""
        const t = bare(R.t);
        if ((R.lit || R.nn) && (t === St || t === 'char')) return R.c;
        if (t === St) return '(' + R.c + ' ?? "")';
        if (t === 'char' || t === In) return R.c;
        if (t === Fl) return '$.sf(' + R.c + ')';
        if (t && isEnumT(t)) return '$.en(' + clsOf(t).js + ', ' + R.c + ')';
        return '$.s(' + R.c + ')';
      }
      function defCode(t){
        t = t && t.endsWith('?') ? null : t;
        if (!t) return 'null';
        if (isNumT(t)) return '0';
        if (t === Bo) return 'false';
        if (t === 'char') return JSON.stringify(CH(0));
        if (t === V3) { USED.add('Vector3'); return 'Vector3.zero'; }
        if (isStructT(t)) return 'new ' + clsOf(genName(t)).js + '()';
        return 'null';
      }
      function coerce(R, to){
        to = bare(to); const from = bare(R.t);
        if (!to || R.isNull) return R.c;
        if (to === In) { if (isIntT(from)) return R.c; if (from === 'char') return '$.ord(' + R.c + ')'; if (from === Fl || from === 'double' || from === 'decimal') return '$.trunc(' + R.c + ')'; return '$.i(' + R.c + ')'; }
        if (to === 'char' && isIntT(from)) return '$.chr(' + R.c + ')';
        if ((to === Fl || to === 'double' || to === 'decimal') && from === 'char') return '$.ord(' + R.c + ')';
        if (isStructT(to) && R.lv) return '$.cl(' + R.c + ')';
        return R.c;
      }
      function raw(n, want){
        switch (n.k) {
          case 'num': return { c: String(n.v), t: n.nt === 'int' ? In : n.nt, pure: true, lit: true, num: n.v };
          case 'str': return { c: JSON.stringify(n.v), t: St, lit: true, pure: true };
          case 'chr': return { c: JSON.stringify(n.v), t: 'char', lit: true, pure: true };
          case 'bool': return { c: String(n.v), t: Bo, pure: true };
          case 'null': return { c: 'null', t: null, isNull: true, pure: true };
          case 'istr': return istr(n);
          case 'id': return rid(n.name, n.line);
          case 'this': return { c: selfRef(n.line), t: FN.cls ? FN.cls.name : null, pure: true };
          case 'base': throw CsErr('base можно только так: base.Метод(…)', n.line);
          case 'mem': return memX(n);
          case 'call': return callX(n);
          case 'idx': return idxX(n);
          case 'new': return newObj(n, want);
          case 'newarr': return newArr(n);
          case 'arrinit': return arrItems(n, elemT(want), rankOf(want) || 1, n.line);
          case 'coll': return collLit(n, want);
          case 'anon': return { c: '({' + n.props.map(q => JSON.stringify(q.name) + ': ' + ex(q.e).c).join(', ') + '})', t: null };
          case 'lambda': return lambdaX(n, want);
          case 'un': return unX(n);
          case 'post': return incX(n.e, n.op, false, n.line);
          case 'bin': return binX(n);
          case 'asg': return asgX(n);
          case 'cond': { const C = condCode(n.c), A = ex(n.a, want), B = ex(n.b, want || A.t); const t = A.isNull ? B.t : B.isNull ? A.t : isNumT(A.t) && isNumT(B.t) && bare(A.t) !== bare(B.t) ? numT(A.t, B.t) : A.t || B.t; return { c: '(' + C + ' ? ' + A.c + ' : ' + B.c + ')', t }; }
          case 'cast': return castX(n);
          case 'is': { const R = ex(n.e), pre = [], s = once(R.c, pre); return { c: seq(pre, patCode(n.pat, s, R.t, n.line)), t: Bo }; }
          case 'as': { checkType(n.ty, n.line); return { c: '$.as(' + ex(n.e).c + ', ' + typeRef(n.ty) + ')', t: n.ty }; }
          case 'typeof': return { c: '$.typeOf(' + JSON.stringify(bare(n.ty)) + ')', t: 'Type' };
          case 'default': return { c: defCode(n.ty || want), t: n.ty || want || null, isNull: !n.ty && !want };
          case 'await': {
            if (!FN || !FN.async) throw CsErr('await можно только в async-методе (добавь async: async void Start() / async Task Метод())', n.line);
            FN.awaits = (FN.awaits || 0) + 1;
            const R = ex(n.e);
            return { c: '(await ' + R.c + ')', t: taskRes(R.t) };
          }
          case 'throw': return { c: '$.thr(' + ex(n.e).c + ')', t: want || null };
          case 'swx': return swX(n, want);
          case 'tuple': {
            const wt = isTupleT(want) ? tupleEls(want) : [];
            const items = n.items.map((it, i) => { if (it.e.k === 'decl') throw CsErr('Объявление в кортеже — только слева от =', n.line); return ex(it.e, wt[i] && wt[i].t); });
            return { c: '[' + items.map(r => r.c).join(', ') + ']', t: '(' + items.map((r, i) => (r.t || 'object') + (n.items[i].name ? ' ' + n.items[i].name : wt[i] && wt[i].n ? ' ' + wt[i].n : '')).join(',') + ')' };
          }
          case 'range': throw CsErr('Диапазон a..b — только в [ ] у строки, массива или списка', n.line);
          case 'decl': throw CsErr('Объявление переменной здесь нельзя', n.line);
          case 'disc': throw CsErr('_ здесь нельзя', n.line);
        }
        throw CsErr('Это выражение не поддерживается', n.line);
      }
      function condCode(e){
        const R = ex(e), t = bare(R.t);
        if (t && t !== Bo && t !== 'object' && (isPrimT(t) || t === V3 || isListT(t))) throw CsErr('Условие должно быть true/false (bool), а здесь ' + t + (e.k === 'asg' ? ' — может, нужно == вместо =?' : ''), e.line);
        return R.c;
      }
      function istr(n){
        const parts = [];
        for (const x of n.parts) {
          if (typeof x === 'string') { if (x) parts.push(JSON.stringify(x)); continue; }
          const R = ex(x.e);
          let c = x.fmt != null ? '$.fmt(' + R.c + ', ' + JSON.stringify(x.fmt) + ')' : strOf(R);
          if (x.al) c = '$.al(' + c + ', ' + ex(x.al).c + ')';
          parts.push(c);
        }
        if (!parts.length) return { c: '""', t: St, lit: true };
        if (!/^"/.test(parts[0])) parts.unshift('""');
        return { c: '(' + parts.join(' + ') + ')', t: St, nn: true };
      }
      // ── доступ к члену: obj.name ──
      function memX(n){
        const name = n.name;
        if (n.o.k === 'base') {
          if (FN.self !== 'this') throw CsErr('base. внутри локальной функции не поддерживается', n.line);
          const bc = FN.cls && baseOf(FN.cls), f = bc && findMem(bc, name);
          return { c: 'super.' + (f ? f.m.js : name), t: f ? f.m.type : (SM[name] && !SM[name].endsWith('()') ? SM[name] : null) };
        }
        const R = raw(n.o);
        if (R.ns) return rid(name, n.line);
        if (R.ty) return staticMem(R.ty, name, n);
        return link(R, n.cond, rc => instMem(recvCode(rc), R.t, name, n));
      }
      function hint(api, name){ const k = Object.keys((API[api] || {}).s || {}).find(x => x.toLowerCase() === name.toLowerCase()); return k ? ' (может, ' + api + '.' + k + '?)' : ''; }
      function staticMem(ty, name, n){
        if (ty.api) {
          const sig = (API[ty.api].s || {})[name];
          if (sig === undefined) throw CsErr(ty.api + '.' + name + ' — такого нет' + hint(ty.api, name), n.line);
          const c = ty.api + '.' + name;
          if (sig.endsWith('()')) return { c, t: 'delegate', apiFn: { api: ty.api, name } };
          return { c, t: sig, pure: true };
        }
        const cls = ty;
        if (cls.kind === 'enum') { const m = cls.mem.get(name); if (!m) throw CsErr('В перечислении ' + cls.name + ' нет «' + name + '»', n.line); return { c: cls.js + '.' + m.js, t: cls.name, pure: true }; }
        const f = findMem(cls, name);
        if (f) { if (!f.m.static) throw CsErr('«' + name + '» — не static: нужен объект ' + cls.name, n.line); return memRef(f.owner, f.m, name, n.line); }
        const nt = CL.get(name); if (nt && nt.outer === cls) return { ty: nt, c: nt.js, t: nt.name };
        throw CsErr('У ' + cls.name + ' нет «' + name + '»', n.line);
      }
      function instMem(rc, t, name, n){
        const bt = bare(t);
        if (bt && isTupleT(bt)) { const els = tupleEls(bt), i = els.findIndex(e => e.n === name); if (i >= 0) return { c: rc + '[' + i + ']', t: els[i].t, lv: true }; }
        const im = /^Item([1-7])$/.exec(name);
        if (im && (!bt || isTupleT(bt))) { const i = +im[1] - 1; return { c: rc + '[' + i + ']', t: bt ? (tupleEls(bt)[i] || {}).t || null : null, lv: true }; }
        const uc = userCls(bt);
        if (uc) {
          const f = findMem(uc, name);
          if (f) { if (f.m.static) throw CsErr('«' + name + '» — static: пиши ' + f.owner.name + '.' + name, n.line); return memRef(f.owner, f.m, name, n.line, rc); }
          if (scriptCls(uc) && Object.prototype.hasOwnProperty.call(SM, name)) { const sig = SM[name]; if (sig.endsWith('()')) return { c: '$.mg(' + rc + ', ' + JSON.stringify(name) + ')', t: 'delegate', mg: { script: name, recv: rc } }; return { c: rc + '.' + name, t: sig, lv: true }; }
          if (uc.exc && (name === 'Message' || name === 'StackTrace')) return { c: rc + '.' + name, t: St };
          throw CsErr('У ' + uc.name + ' нет «' + name + '»', n.line);
        }
        if (bt === St && name === 'Length') return { c: rc + '.length', t: In };
        if (bt && (isArrT(bt) || genName(bt) === 'List') && (name === 'Count' || name === 'Length')) return rankOf(bt) > 1 && name === 'Length' ? { c: '$.len2(' + rc + ')', t: In } : { c: rc + '.length', t: In };
        if (bt && isDictT(bt)) { const a = genArgs(bt); if (name === 'Keys') return { c: rc + '.Keys', t: 'List<' + a[0] + '>' }; if (name === 'Values') return { c: rc + '.Values', t: 'List<' + a[1] + '>' }; }
        if (bt && genName(bt) === 'KeyValuePair') { const a = genArgs(bt); if (name === 'Key') return { c: rc + '.Key', t: a[0] || null }; if (name === 'Value') return { c: rc + '.Value', t: a[1] || null }; }
        if (bt === V3 && /^[xyz]$/.test(name)) return { c: rc + '.' + name.toUpperCase(), t: Fl, lv: true };
        if (!bt || !isPrimT(bt)) {
          if (name === 'transform' && bt !== 'Transform') return { c: '$.tf(' + rc + ')', t: 'Transform' };
          if (name === 'gameObject' && bt !== 'GameObject') return { c: '$.go(' + rc + ')', t: 'GameObject' };
          if (name === 'tag') return { c: '$.tag(' + rc + ')', t: St };
          if (name === 'name' && bt !== 'Transform' && bt !== 'GameObject') return { c: '$.nm(' + rc + ')', t: St };
        }
        return { c: rc + '.' + name, t: Object.prototype.hasOwnProperty.call(MT, name) ? MT[name] : null, lv: true, pure: pureCode(rc) };
      }
      // ── индексы: a[i], d["k"], s[^1], s[1..3], m[i, j] ──
      function idxX(n){
        const R = raw(n.o);
        if (R.ty || R.ns) throw CsErr('[ ] — у значения, а не у типа', n.line);
        return link(R, n.cond, rc => idxCode(recvCode(rc), R.t, n));
      }
      function idxCode(rc, t, n){
        const bt = bare(t), A = n.args;
        if (A.length === 1 && A[0].k === 'un' && A[0].op === '^') return { c: '$.ixh(' + rc + ', ' + ex(A[0].e).c + ')', t: elemT(bt) };
        if (A.length === 1 && A[0].k === 'range') {
          const r = A[0], end = e => !e ? ['null', 'false'] : e.k === 'un' && e.op === '^' ? [ex(e.e).c, 'true'] : [ex(e).c, 'false'];
          const a = end(r.a), b = end(r.b);
          return { c: '$.rng(' + rc + ', ' + a[0] + ', ' + a[1] + ', ' + b[0] + ', ' + b[1] + ')', t: bt };
        }
        const uc = userCls(bt);
        if (uc && uc.indexer) return { c: rc + '.$get(' + A.map(a => ex(a).c).join(', ') + ')', t: uc.indexer.ty };
        if (A.length > 1) { let c = rc; for (const a of A) c = '$.ix(' + c + ', ' + ex(a).c + ')'; return { c, t: elemT(bt) }; }
        const I = ex(A[0]);
        if (isDictT(bt)) return { c: '$.dget(' + rc + ', ' + I.c + ')', t: genArgs(bt)[1] || null };
        return { c: '$.ix(' + rc + ', ' + I.c + ')', t: bt === St ? 'char' : elemT(bt) };
      }
      // ── то, чему можно присвоить: { get, set(v), t, simple, code } ──
      const isLvNode = n => n.k === 'id' || ((n.k === 'mem' || n.k === 'idx') && !n.cond);
      function lval(l, pre){
        if (l.k === 'id') {
          const R = rid(l.name, l.line);
          if (R.mg) throw CsErr('«' + l.name + '» — метод, его нельзя менять', l.line);
          if (R.ty || R.api || R.ns) throw CsErr('«' + l.name + '» — не переменная', l.line);
          if (R.loc && R.loc.isConst) throw CsErr('Константу «' + l.name + '» менять нельзя', l.line);
          if (R.loc && R.loc.fe) throw CsErr('Переменную цикла foreach «' + l.name + '» менять нельзя', l.line);
          if (R.lv === false) throw CsErr('«' + l.name + '» только для чтения', l.line);
          return { get: R.c, set: v => R.c + ' = ' + v, t: R.t, simple: true, code: R.c };
        }
        if (l.k === 'mem') {
          if (l.cond) throw CsErr('Присваивание через ?. не поддерживается', l.line);
          if (l.o.k === 'base') { const R = memX(l); return { get: R.c, set: v => R.c + ' = ' + v, t: R.t, simple: true, code: R.c }; }
          const O = raw(l.o);
          if (O.cond) throw CsErr('Присваивание через ?. не поддерживается', l.line);
          if (O.ns) return lval({ k: 'id', name: l.name, line: l.line }, pre);
          if (O.ty) { const R = staticMem(O.ty, l.name, l); if (R.mg || R.apiFn || R.lv === false || O.ty.api) throw CsErr('«' + l.name + '» нельзя менять', l.line); return { get: R.c, set: v => R.c + ' = ' + v, t: R.t, simple: true, code: R.c }; }
          const bt = bare(O.t), uc = userCls(bt);
          const comp = !uc && ((bt === V3 && /^[xyzXYZ]$/.test(l.name)) || (!bt && /^[xyzXYZ]$/.test(l.name)) || (bt === Co && /^[rgba]$/.test(l.name)));
          if (comp) {   // копия при записи: v.x = 5 → v = $.setm(v, "x", 5) — Vector3 неизменяемый, как struct в C#
            const OL = isLvNode(l.o) ? lval(l.o, pre) : null, nm = JSON.stringify(l.name), rd = bt === V3 ? l.name.toUpperCase() : l.name;
            if (OL) return { get: OL.get + '.' + rd, set: v => OL.set('$.setm(' + OL.get + ', ' + nm + ', ' + v + ')'), t: Fl };
            const oc = once(recvCode(O.c), pre);
            return { get: oc + '.' + rd, set: v => '$.setm(' + oc + ', ' + nm + ', ' + v + ')', t: Fl };
          }
          const oc = once(recvCode(O.c), pre);
          if (uc) {
            const f = findMem(uc, l.name);
            if (!f) { if (scriptCls(uc) && (l.name === 'enabled' || l.name === 'name' || l.name === 'tag')) { const code = oc + '.' + l.name; return { get: code, set: v => code + ' = ' + v, t: SM[l.name], simple: true, code }; } throw CsErr('У ' + uc.name + ' нет «' + l.name + '»', l.line); }
            if (f.m.kind === 'method') throw CsErr('«' + l.name + '» — метод, его нельзя менять', l.line);
            if (f.m.static) throw CsErr('«' + l.name + '» — static: пиши ' + f.owner.name + '.' + l.name, l.line);
            const code = oc + '.' + f.m.js;
            return { get: code, set: v => code + ' = ' + v, t: f.m.type, simple: true, code };
          }
          if (!bt || !isPrimT(bt)) {
            if (l.name === 'name' && bt !== 'Transform' && bt !== 'GameObject') return { get: '$.nm(' + oc + ')', set: v => '$.setnm(' + oc + ', ' + v + ')', t: St };
            if (l.name === 'tag') return { get: '$.tag(' + oc + ')', set: v => '$.settag(' + oc + ', ' + v + ')', t: St };
            if (l.name === 'transform' || l.name === 'gameObject') throw CsErr(l.name + ' менять нельзя', l.line);
          }
          const code = oc + '.' + l.name;
          return { get: code, set: v => code + ' = ' + v, t: Object.prototype.hasOwnProperty.call(MT, l.name) ? MT[l.name] : null, simple: true, code };
        }
        if (l.k === 'idx') {
          if (l.cond) throw CsErr('Присваивание через ?[ ] не поддерживается', l.line);
          const O = ex(l.o), bt = bare(O.t), oc = once(recvCode(O.c), pre), uc = userCls(bt);
          if (l.args.length > 1) {
            let b = oc; for (const a of l.args.slice(0, -1)) b = '$.ix(' + b + ', ' + ex(a).c + ')';
            const bc = once(b, pre), ic = once(ex(l.args[l.args.length - 1]).c, pre);
            return { get: '$.ix(' + bc + ', ' + ic + ')', set: v => '$.sx(' + bc + ', ' + ic + ', ' + v + ')', t: elemT(bt) };
          }
          const a = l.args[0];
          if (a.k === 'un' && a.op === '^') { const ic = once(ex(a.e).c, pre); return { get: '$.ixh(' + oc + ', ' + ic + ')', set: v => '$.sxh(' + oc + ', ' + ic + ', ' + v + ')', t: elemT(bt) }; }
          const ic = once(ex(a).c, pre);
          if (uc && uc.indexer) return { get: oc + '.$get(' + ic + ')', set: v => oc + '.$set(' + ic + ', ' + v + ')', t: uc.indexer.ty };
          if (isDictT(bt)) return { get: '$.dget(' + oc + ', ' + ic + ')', set: v => '$.dset(' + oc + ', ' + ic + ', ' + v + ')', t: genArgs(bt)[1] || null };
          if (bt === St) throw CsErr('Строку нельзя менять по символам (строки в C# неизменяемые)', l.line);
          return { get: '$.ix(' + oc + ', ' + ic + ')', set: v => '$.sx(' + oc + ', ' + ic + ', ' + v + ')', t: elemT(bt) };
        }
        throw CsErr('Сюда нельзя присвоить значение', l.line);
      }
      // ── присваивание, события += / -= ──
      function asgX(n){
        const op = n.op, l = n.l;
        if (l.k === 'tuple') {
          if (op !== '=') throw CsErr('Кортежу можно только присвоить (=)', n.line);
          const R = ex(n.r), rt = isTupleT(R.t) ? tupleEls(R.t) : [], pre = [];
          const tg = l.items.map((it, i) => {
            if (it.e.k === 'decl') { if (it.e.ty) checkType(it.e.ty, n.line); const v = declare(it.e.name, it.e.ty || (rt[i] && rt[i].t) || null, n.line); PEND.push(v.js); return v.js; }
            if (it.e.k === 'id' && it.e.name === '_') return '';
            const L = lval(it.e, pre); if (!L.simple) throw CsErr('В (a, b) = … — только переменные и поля', n.line); return L.code;
          });
          return { c: seq(pre, '[' + tg.join(', ') + '] = ' + (n.r.k === 'tuple' ? R.c : '$.dc(' + R.c + ')')), t: R.t };
        }
        if (op === '+=' || op === '-=') { const e = eventAsg(n); if (e) return e; }
        const pre = [], L = lval(l, pre);
        if (op === '=') { const R = ex(n.r, L.t); return { c: seq(pre, L.set(coerce(R, L.t))), t: L.t }; }
        if (op === '??=') { const R = ex(n.r, L.t); return { c: seq(pre, L.simple ? '(' + L.code + ' ??= ' + R.c + ')' : L.set('(' + L.get + ' ?? ' + R.c + ')')), t: L.t }; }
        const bop = op.slice(0, -1), R = ex(n.r), lt = bare(L.t), rt = bare(R.t);
        if (L.simple && fastOp(bop, lt, rt)) return { c: seq(pre, '(' + L.code + ' ' + op + ' ' + R.c + ')'), t: L.t };
        const v = binCode(bop, { c: L.get, t: L.t }, R, n.line);
        return { c: seq(pre, L.set(coerce(v, L.t))), t: L.t };
      }
      function fastOp(op, lt, rt){
        if (isIntT(lt) && isIntT(rt)) return ['+', '-', '*', '%', '<<', '>>', '>>>', '&', '|', '^'].includes(op);
        if ((lt === Fl || lt === 'double' || lt === 'decimal') && isNumT(rt)) return ['+', '-', '*', '/', '%'].includes(op);
        return false;
      }
      function eventAsg(n){
        const add = n.op === '+=', l = n.l, r = n.r;
        if (l.k !== 'id' && l.k !== 'mem') return null;
        const isH = R => r.k === 'lambda' || !!R.mg || !!R.apiFn || isDelT(R.t) || R.t === 'delegate';
        if (l.k === 'mem') {
          if (l.o.k === 'base') return null;
          const O = raw(l.o);
          if (O.ns || O.cond) return null;
          if (O.ty) {   // Класс.СтатическоеСобытие += …
            if (O.ty.api) return null;
            const f = findMem(O.ty, l.name); if (!f || !(f.m.kind === 'event' || isDelT(f.m.type))) return null;
            const H = r.k === 'lambda' ? lambdaX(r, f.m.type) : ex(r, f.m.type), code = O.ty.js + '.' + f.m.js;
            return { c: code + ' = $.' + (add ? 'dadd' : 'dsub') + '(' + code + ', ' + H.c + ')', t: 'void' };
          }
          const uc = userCls(O.t);
          if (uc) {
            const f = findMem(uc, l.name);
            if (!f || !(f.m.kind === 'event' || isDelT(f.m.type))) return null;
            const pre = [], oc = once(recvCode(O.c), pre), H = r.k === 'lambda' ? lambdaX(r, f.m.type) : ex(r, f.m.type), code = oc + '.' + f.m.js;
            return { c: seq(pre, code + ' = $.' + (add ? 'dadd' : 'dsub') + '(' + code + ', ' + H.c + ')'), t: 'void' };
          }
          const sig = SIG.has(l.name), H = r.k === 'lambda' ? lambdaX(r, null) : ex(r);
          if (!sig && !isH(H)) return null;
          return { c: '$.' + (add ? 'evAdd' : 'evRem') + '(' + recvCode(fin(O).c) + ', ' + JSON.stringify(l.name) + ', ' + H.c + ')', t: 'void' };
        }
        const T0 = rid(l.name, l.line);
        if (T0.mg || T0.ty || T0.api || T0.ns) return null;
        const H = r.k === 'lambda' ? lambdaX(r, isDelT(T0.t) ? T0.t : null) : ex(r, T0.t);
        if (!(isDelT(T0.t) || (T0.mem && T0.mem.kind === 'event') || isH(H))) return null;
        return { c: T0.c + ' = $.' + (add ? 'dadd' : 'dsub') + '(' + T0.c + ', ' + H.c + ')', t: 'void' };
      }
      // ── операторы ──
      function userOp(op, lt, rt){
        for (const t of [lt, rt]) { const uc = userCls(t); if (uc && uc.ops[op]) return { c: uc.js + '.' + OPN[op], t: uc.ops[op].fn.ret }; }
        return null;
      }
      function binX(n){
        const op = n.op;
        if (op === '&&' || op === '||') return { c: '(' + condCode(n.l) + ' ' + op + ' ' + condCode(n.r) + ')', t: Bo };
        if (op === '??') { const L = ex(n.l), R = ex(n.r, L.t); return { c: '(' + L.c + ' ?? ' + R.c + ')', t: L.t || R.t }; }
        return binCode(op, ex(n.l), ex(n.r), n.line);
      }
      const ordIf = (R, cond) => cond ? '$.ord(' + R.c + ')' : R.c;
      function binCode(op, L, R, line){
        const lt = bare(L.t), rt = bare(R.t);
        const uo = OPN[op] && userOp(op, lt, rt);
        if (uo) { const c = uo.c + '(' + L.c + ', ' + R.c + ')'; return op === '!=' && !userCls(lt)?.ops['!='] && !userCls(rt)?.ops['!='] ? { c: '!' + c, t: Bo } : { c, t: uo.t }; }
        if (op === '!=' && (userCls(lt)?.ops['=='] || userCls(rt)?.ops['=='])) { const u = userOp('==', lt, rt); return { c: '!' + u.c + '(' + L.c + ', ' + R.c + ')', t: Bo }; }
        const ln = isNumT(lt), rn = isNumT(rt), lc = lt === 'char', rc = rt === 'char';
        switch (op) {
          case '+':
            if (lt === St || rt === St) return { c: '(' + strOf(L) + ' + ' + strOf(R) + ')', t: St, nn: true };
            if ((ln || lc) && (rn || rc)) return { c: '(' + ordIf(L, lc) + ' + ' + ordIf(R, rc) + ')', t: numT(lt, rt) };
            if (isDelT(lt) || isDelT(rt)) return { c: '$.dadd(' + L.c + ', ' + R.c + ')', t: lt || rt };
            return { c: '$.add(' + L.c + ', ' + R.c + ')', t: lt === V3 || rt === V3 ? V3 : null };
          case '-':
            if ((ln || lc) && (rn || rc)) return { c: '(' + ordIf(L, lc) + ' - ' + ordIf(R, rc) + ')', t: numT(lt, rt) };
            if (isDelT(lt)) return { c: '$.dsub(' + L.c + ', ' + R.c + ')', t: lt };
            return { c: '$.sub(' + L.c + ', ' + R.c + ')', t: lt === V3 || rt === V3 ? V3 : null };
          case '*':
            if ((ln || lc) && (rn || rc)) return { c: '(' + ordIf(L, lc) + ' * ' + ordIf(R, rc) + ')', t: numT(lt, rt) };
            return { c: '$.mul(' + L.c + ', ' + R.c + ')', t: lt === V3 || rt === V3 ? V3 : null };
          case '/':
            if ((isIntT(lt) || lc) && (isIntT(rt) || rc)) return { c: '$.idiv(' + ordIf(L, lc) + ', ' + ordIf(R, rc) + ')', t: In };
            if ((ln || lc) && (rn || rc)) return { c: '(' + ordIf(L, lc) + ' / ' + ordIf(R, rc) + ')', t: numT(lt, rt) };
            return { c: '$.div(' + L.c + ', ' + R.c + ')', t: lt === V3 ? V3 : null };
          case '%':
            if ((isIntT(lt) || lc) && (isIntT(rt) || rc)) return { c: '$.imod(' + ordIf(L, lc) + ', ' + ordIf(R, rc) + ')', t: In };
            return { c: '(' + ordIf(L, lc) + ' % ' + ordIf(R, rc) + ')', t: ln && rn ? numT(lt, rt) : null };
          case '==': case '!=': return eqCode(op, L, R);
          case '<': case '>': case '<=': case '>=': return { c: '(' + ordIf(L, lc && !rc) + ' ' + op + ' ' + ordIf(R, rc && !lc) + ')', t: Bo };
          case '&': case '|':
            if (lt === Bo || rt === Bo) return { c: '!!(' + L.c + ' ' + op + ' ' + R.c + ')', t: Bo };
            return { c: '(' + L.c + ' ' + op + ' ' + R.c + ')', t: isEnumT(lt) ? lt : In };
          case '^':
            if (lt === Bo || rt === Bo) return { c: '(' + L.c + ' !== ' + R.c + ')', t: Bo };
            return { c: '(' + L.c + ' ^ ' + R.c + ')', t: In };
          case '<<': case '>>': case '>>>': return { c: '(' + L.c + ' ' + op + ' ' + R.c + ')', t: In };
          case '&&': case '||': return { c: '(' + L.c + ' ' + op + ' ' + R.c + ')', t: Bo };
          case '??': return { c: '(' + L.c + ' ?? ' + R.c + ')', t: lt || rt };
        }
        throw CsErr('Оператор ' + op + ' не поддерживается', line);
      }
      function eqCode(op, L, R){
        const neg = op === '!=';
        if (L.isNull || R.isNull) { const X = L.isNull ? R : L; return { c: '(' + X.c + (neg ? ' != null)' : ' == null)'), t: Bo }; }
        const lt = bare(L.t), rt = bare(R.t);
        if (isPrimT(lt) && isPrimT(rt)) {
          const a = lt === 'char' && rt !== 'char' && rt !== St ? '$.ord(' + L.c + ')' : L.c, b = rt === 'char' && lt !== 'char' && lt !== St ? '$.ord(' + R.c + ')' : R.c;
          return { c: '(' + a + (neg ? ' !== ' : ' === ') + b + ')', t: Bo };
        }
        return { c: (neg ? '!' : '') + '$.eq(' + L.c + ', ' + R.c + ')', t: Bo };
      }
      function unX(n){
        const op = n.op;
        if (op === '++' || op === '--') return incX(n.e, op, true, n.line);
        if (op === '^') throw CsErr('^ (индекс с конца) — только в [ ]', n.line);
        const R = ex(n.e), t = bare(R.t), uc = userCls(t);
        if (uc && uc.ops['u' + op]) return { c: uc.js + '.' + OPN['u' + op] + '(' + R.c + ')', t: uc.ops['u' + op].fn.ret };
        if (op === '-') { if (isNumT(t)) return { c: '(-' + R.c + ')', t, lit: R.lit, num: R.num !== undefined ? -R.num : undefined }; if (t === 'char') return { c: '(-$.ord(' + R.c + '))', t: In }; return { c: '$.neg(' + R.c + ')', t: t === V3 ? V3 : null }; }
        if (op === '+') return t === 'char' ? { c: '$.ord(' + R.c + ')', t: In } : R;
        if (op === '!') return { c: '!' + R.c, t: Bo };
        return { c: '~' + R.c, t: In };
      }
      function incX(e, op, prefix, line){
        const pre = [], L = lval(e, pre), t = bare(L.t);
        if (L.simple && (isNumT(t) || !t)) return { c: seq(pre, prefix ? '(' + op + L.code + ')' : '(' + L.code + op + ')'), t: L.t };
        const one = { c: '1', t: In }, step = g => t === 'char' ? '$.chr($.ord(' + g + ') ' + op[0] + ' 1)' : binCode(op[0], { c: g, t: L.t }, one, line).c;
        if (prefix) return { c: seq(pre, L.set(step(L.get))), t: L.t };
        const old = tmp(); pre.push(old + ' = ' + L.get);
        return { c: seq(pre, '(' + L.set(step(old)) + ', ' + old + ')'), t: L.t };
      }
      function castX(n){
        const to = bare(n.ty); checkType(n.ty, n.line);
        const R = ex(n.e), from = bare(R.t);
        if (to === In) { if (isIntT(from)) return { c: R.c, t: In }; if (from === 'char') return { c: '$.ord(' + R.c + ')', t: In }; return { c: '$.trunc(' + R.c + ')', t: In }; }
        if (to === Fl || to === 'double' || to === 'decimal') { if (from === 'char') return { c: '$.ord(' + R.c + ')', t: to }; if (isNumT(from)) return { c: R.c, t: to }; return { c: '$.num(' + R.c + ')', t: to }; }
        if (to === 'char') return from === 'char' ? R : { c: '$.chr(' + R.c + ')', t: 'char' };
        if (isEnumT(to)) return { c: R.c, t: to };
        const uc = userCls(to);
        if (uc && uc.kind !== 'interface') return { c: '$.cast(' + R.c + ', ' + uc.js + ')', t: to };
        return { c: R.c, t: n.ty };
      }
      // ── шаблоны (is, case, switch-выражения) ──
      function declVar(name, t, line){ const v = declare(name, t, line); PEND.push(v.js); return v; }
      function typeOfName(e){
        if (e.k === 'id') {
          if (lookup(e.name) || (FN && FN.cls && findMem(FN.cls, e.name))) return null;
          if (clsOf(e.name)) return e.name;
          const an = ALIAS[e.name] || e.name;
          if (TYPES.has(an) || (API[an] && API[an].type)) return an;
          return null;
        }
        if (e.k === 'mem' && e.o.k === 'id' && NS.has(e.o.name) && !lookup(e.o.name)) return typeOfName({ k: 'id', name: e.name });
        return null;
      }
      function typeRef(t){
        t = bare(t); const g = genName(t), uc = clsOf(g);
        if (uc && (uc.kind === 'class' || uc.kind === 'struct')) return uc.js;
        if (EXC.has(g) || ['Dictionary', 'HashSet', 'Queue', 'Stack', 'StringBuilder', 'Random'].includes(g)) { USED.add(g); return g; }
        if (isArrT(t) || g === 'List' || g === 'IList') return '"List"';
        return JSON.stringify(ALIAS[g] || g);
      }
      function patCode(p, s, t, line){
        switch (p.p) {
          case 'null': return '(' + s + ' == null)';
          case 'disc': return 'true';
          case 'var': { const v = declVar(p.name, t, line); return '((' + v.js + ' = ' + s + '), true)'; }
          case 'not': return '!' + patCode(p.a, s, t, line);
          case 'and': return '(' + patCode(p.a, s, t, line) + ' && ' + patCode(p.b, s, t, line) + ')';
          case 'or': return '(' + patCode(p.a, s, t, line) + ' || ' + patCode(p.b, s, t, line) + ')';
          case 'rel': { const R = ex(p.e); return '(' + (bare(t) === 'char' && bare(R.t) !== 'char' ? '$.ord(' + s + ')' : s) + ' ' + p.op + ' ' + R.c + ')'; }
          case 'type': {
            checkType(p.ty, line);
            const tc = '$.is(' + s + ', ' + typeRef(p.ty) + ')';
            if (!p.name) return tc;
            const v = declVar(p.name, p.ty, line);
            return '(' + tc + ' && ((' + v.js + ' = ' + s + '), true))';
          }
          case 'name': { const tn = typeOfName(p.e); if (tn) return '$.is(' + s + ', ' + typeRef(tn) + ')'; return eqCode('==', { c: s, t }, ex(p.e)).c; }
          case 'const': return eqCode('==', { c: s, t }, ex(p.e)).c;
        }
        throw CsErr('Шаблон не поддерживается', line);
      }
      const constPat = p => p.p === 'null' || p.p === 'const' || (p.p === 'name' && !typeOfName(p.e));
      function swX(n, want){
        const R = ex(n.e), sv = '$sw' + (++TMP), saveP = PEND;
        PEND = [];
        const aw0 = FN && FN.awaits || 0;
        let t = want || null;
        const arms = n.arms.map(a => {
          push();
          let c = patCode(a.pat, sv, R.t, a.line);
          if (a.when) c = '(' + c + ' && ' + condCode(a.when) + ')';
          const V = ex(a.e, t);
          if (!t && !V.isNull) t = V.t;
          pop();
          return [c, V.c, a.line];
        });
        let code = '$.swf(' + sv + ')';
        for (let i = arms.length - 1; i >= 0; i--) code = mark(arms[i][2]) + (arms[i][0] === 'true' ? arms[i][1] : arms[i][0] + ' ? ' + arms[i][1] + ' : ' + code);
        const decl = PEND.length ? 'let ' + [...new Set(PEND)].join(', ') + '; ' : '';
        PEND = saveP;
        const aw = (FN && FN.awaits || 0) > aw0;
        const f = '(' + (aw ? 'async ' : '') + '(' + sv + ') => { ' + decl + 'return ' + code + '; })(' + R.c + ')';
        return { c: aw ? '(await ' + f + ')' : f, t };
      }

      // ── вызовы ──
      function argR(a, pty){   // аргумент → { c, t }; ref/out — «коробка» { v }
        if (a.mod === 'out' || a.mod === 'ref') return { c: refBox(a.e, pty, a.line), t: pty };
        if (a.e.k === 'lambda') return lambdaX(a.e, pty);
        const R = ex(a.e, pty);
        return { c: pty ? coerce(R, pty) : R.c, t: R.t, mg: R.mg };
      }
      function refBox(e, t, line){
        if (e.k === 'disc' || (e.k === 'id' && e.name === '_' && !lookup('_'))) return '$.box()';
        if (e.k === 'decl') {
          if (e.ty) checkType(e.ty, line);
          const vt = e.ty || t || null, v = declVar(e.name, vt, e.line || line);
          return '$.rf(() => ' + v.js + ', $v => ' + v.js + ' = ' + coerce({ c: '$v', t: null }, vt) + ')';
        }
        const pre = [], L = lval(e, pre);
        if (pre.length) throw CsErr('ref/out — только переменная, поле или элемент массива', line);
        return '$.rf(() => ' + L.get + ', $v => ' + L.set('$v') + ')';
      }
      function callX(n){
        const f = n.f;
        if (f.k === 'id') {
          const R = rid(f.name, f.line);
          if (R.mg) return callMG(R.mg, n, f.targs);
          if (R.api && API[R.api].f !== undefined) return apiFn(R.api, n, f.targs);
          if (R.ty) throw CsErr('Чтобы создать объект, пиши new ' + f.name + '(…)', n.line);
          if (R.ns) throw CsErr('«' + f.name + '» — не метод', n.line);
          return { c: '$.inv(' + [R.c].concat(n.args.map(a => argR(a).c)).join(', ') + ')', t: delRet(R.t) };
        }
        if (f.k === 'mem') return callMem(f, n);
        const R = ex(f);
        return { c: '$.inv(' + [R.c].concat(n.args.map(a => argR(a).c)).join(', ') + ')', t: delRet(R.t) };
      }
      function callMem(f, n){
        const name = f.name;
        if (f.o.k === 'base') {
          if (!FN || !FN.cls) throw CsErr('base — только внутри класса', n.line);
          if (FN.self !== 'this') throw CsErr('base. внутри локальной функции не поддерживается', n.line);
          const bc = baseOf(FN.cls), fm = bc && findMem(bc, name);
          if (fm && fm.m.kind === 'method') return callUser(fm.owner, fm.m, 'super', n);
          if (scriptCls(FN.cls) && (MSGS.includes(name) || SM[name])) return { c: '(super.' + name + ' && super.' + name + '(' + n.args.map(a => argR(a).c).join(', ') + '))', t: null };
          throw CsErr('У базового класса нет метода ' + name, n.line);
        }
        const R = raw(f.o);
        if (R.ns) return callX({ k: 'call', f: { k: 'id', name, targs: f.targs, line: f.line }, args: n.args, line: n.line });
        if (R.ty && !R.ty.api) {
          const c = R.ty, fm = c.kind === 'enum' ? null : findMem(c, name);
          if (fm && fm.m.kind === 'method') { if (!fm.m.static) throw CsErr('«' + name + '» — не static: нужен объект ' + c.name, n.line); return callUser(fm.owner, fm.m, fm.owner.js, n); }
          if (fm && fm.m.static && isDelT(fm.m.type)) return { c: '$.inv(' + [fm.owner.js + '.' + fm.m.js].concat(n.args.map(a => argR(a).c)).join(', ') + ')', t: delRet(fm.m.type) };
          throw CsErr('У ' + c.name + ' нет метода ' + name, n.line);
        }
        if (R.ty && R.ty.api) return apiStatic(R.ty.api, name, n, f.targs);
        return link(R, f.cond, rc => instCall(recvCode(rc), R.t, name, f, n));
      }
      const LAMBDA_ELEM = new Set(['Find', 'FindAll', 'FindIndex', 'FindLast', 'FindLastIndex', 'Exists', 'TrueForAll', 'RemoveAll', 'ForEach', 'ConvertAll', 'Where',
        'Select', 'SelectMany', 'Any', 'All', 'First', 'FirstOrDefault', 'Last', 'LastOrDefault', 'Single', 'SingleOrDefault', 'Sum', 'Average', 'Max', 'Min', 'MaxBy',
        'MinBy', 'OrderBy', 'OrderByDescending', 'ThenBy', 'ThenByDescending', 'TakeWhile', 'SkipWhile', 'GroupBy', 'ToDictionary', 'DistinctBy']);
      function instCall(rc, t, name, f, n){
        const bt = bare(t), A = n.args, uc = userCls(bt);
        if (uc) {
          const fm = findMem(uc, name);
          if (fm) {
            if (fm.m.kind === 'method') { if (fm.m.static) throw CsErr('«' + name + '» — static: пиши ' + fm.owner.name + '.' + name + '(…)', n.line); return callUser(fm.owner, fm.m, rc, n); }
            return { c: '$.inv(' + [rc + '.' + fm.m.js].concat(A.map(a => argR(a).c)).join(', ') + ')', t: delRet(fm.m.type) };
          }
          if (scriptCls(uc) && SM[name] && SM[name].endsWith('()')) return callMG({ script: name, recv: rc }, n, f.targs);
        }
        const all = () => A.map(a => argR(a).c);
        switch (name) {
          case 'ToString':
            if (A.length > 1) break;
            if (!A.length && bt && isEnumT(bt)) return { c: '$.en(' + clsOf(bt).js + ', ' + rc + ')', t: St, nn: true };
            if (!A.length && bt === Fl) return { c: '$.sf(' + rc + ')', t: St, nn: true };
            return { c: '$.str(' + [rc].concat(all()).join(', ') + ')', t: St, nn: true };
          case 'Equals': if (A.length === 1 && !uc) return { c: '$.equals(' + rc + ', ' + all()[0] + ')', t: Bo }; break;
          case 'GetHashCode': if (!A.length && !uc) return { c: '$.hash(' + rc + ')', t: In }; break;
          case 'GetType': if (!A.length && !uc) return { c: '$.type(' + rc + ')', t: 'Type' }; break;
          case 'CompareTo': if (A.length === 1 && !uc) return { c: '$.cmp(' + rc + ', ' + all()[0] + ')', t: In }; break;
          case 'Connect': if (A.length === 1 && !uc) return { c: '$.conn(' + rc + ', ' + argR(A[0]).c + ')', t: 'Connection' }; break;
          case 'Invoke': if (!uc) return { c: '$.inv(' + [rc].concat(all()).join(', ') + ')', t: delRet(bt) }; break;
          case 'Count': if (!uc) return { c: rc + '.$Count(' + (A.length ? argR(A[0], 'Func<' + (elemT(bt) || 'object') + ',bool>').c : '') + ')', t: In }; break;
          case 'CompareTag': if (A.length === 1 && !uc) return { c: '$.ctag(' + rc + ', ' + all()[0] + ')', t: Bo }; break;
          case 'GetComponent': case 'GetComponents': case 'AddComponent':
            if (!uc) { const ta = f.targs && f.targs[0]; if (ta) checkType(ta, n.line); return { c: '$.gc(' + rc + ', ' + (ta ? typeRef(ta) : all()[0] || 'null') + ', ' + (name === 'GetComponents') + ')', t: ta ? (name === 'GetComponents' ? ta + '[]' : ta) : null }; }
            break;
        }
        const et = elemT(bt);
        const lh = name === 'Sort' ? (et ? 'Comparison<' + et + '>' : null) : name === 'Aggregate' && et ? 'Func<' + et + ',' + et + ',' + et + '>' : et && LAMBDA_ELEM.has(name) ? 'Func<' + et + ',object>' : null;
        const outT = name === 'TryGetValue' && isDictT(bt) ? genArgs(bt)[1] : /^Try(Dequeue|Pop|Peek)$/.test(name) ? et : null;
        const R = A.map(a => argR(a, a.mod === 'out' ? outT : a.e.k === 'lambda' ? lh : null));
        const ct = callT(bt, name, R);
        return { c: rc + '.' + name + '(' + R.map(r => r.c).join(', ') + ')', t: ct, nn: ct === St && (bt === St || name === 'ToString') };
      }
      function callT(bt, name, R){
        const et = elemT(bt);
        if (bt === St) {
          if (name === 'Split') return 'string[]';
          if (name === 'ToCharArray') return 'char[]';
          if (['IndexOf', 'LastIndexOf', 'CompareTo', 'IndexOfAny'].includes(name)) return In;
          if (['Contains', 'StartsWith', 'EndsWith', 'Equals'].includes(name)) return Bo;
          return St;
        }
        if (et && bt !== St) {
          switch (name) {
            case 'Find': case 'FindLast': case 'First': case 'FirstOrDefault': case 'Last': case 'LastOrDefault': case 'ElementAt': case 'ElementAtOrDefault':
            case 'Single': case 'SingleOrDefault': case 'MaxBy': case 'MinBy': case 'Dequeue': case 'Peek': case 'Pop': case 'Aggregate': return et;
            case 'Max': case 'Min': case 'Sum': return R.length ? (R[0].bt || null) : et;
            case 'Average': return 'double';
            case 'FindAll': case 'Where': case 'ToList': case 'ToArray': case 'GetRange': case 'OrderBy': case 'OrderByDescending': case 'ThenBy': case 'ThenByDescending':
            case 'Take': case 'Skip': case 'TakeLast': case 'SkipLast': case 'TakeWhile': case 'SkipWhile': case 'Distinct': case 'DistinctBy': case 'Concat': case 'Union':
            case 'Intersect': case 'Except': case 'Append': case 'Prepend': return 'List<' + et + '>';
            case 'Select': case 'ConvertAll': return 'List<' + (R[0] && R[0].bt || 'object') + '>';
            case 'IndexOf': case 'FindIndex': case 'FindLastIndex': case 'LastIndexOf': case 'RemoveAll': case 'BinarySearch': return In;
            case 'Contains': case 'Exists': case 'TrueForAll': case 'Any': case 'All': case 'SequenceEqual': return Bo;
            case 'Remove': return genName(bt) === 'List' || genName(bt) === 'HashSet' ? Bo : null;
          }
        }
        if (isDictT(bt)) { const a = genArgs(bt); if (['ContainsKey', 'ContainsValue', 'Remove', 'TryGetValue', 'TryAdd'].includes(name)) return Bo; if (name === 'GetValueOrDefault') return a[1] || null; }
        if (bt === V3) { if (name === 'Dot' || name === 'Angle') return Fl; if (['Lerp', 'Cross', 'Normalize'].includes(name)) return V3; }
        return Object.prototype.hasOwnProperty.call(MR, name) ? MR[name] : null;
      }
      function callMG(mg, n, targs){
        if (mg.local) return callFn(mg.local.fn, mg.local.js, n);
        if (mg.script) {
          const name = mg.script, A = n.args;
          if (name === 'print') return { c: mg.recv + '.print(' + A.map(a => strOf(ex(a.e))).join(', ') + ')', t: 'void' };
          if (/^(GetComponents?|FindObjectsOfType|FindObjectOfType)$/.test(name)) {
            const ta = targs && targs[0]; if (ta) checkType(ta, n.line);
            return { c: mg.recv + '.' + name + '(' + (ta ? typeRef(ta) : A.map(a => argR(a).c).join(', ')) + ')', t: ta ? (/s$/.test(name) ? ta + '[]' : ta) : null };
          }
          return { c: mg.recv + '.' + name + '(' + A.map(a => argR(a).c).join(', ') + ')', t: sigRet(SM[name]) };
        }
        return callUser(mg.owner, mg.m, mg.recv, n);
      }
      function callUser(owner, m, recv, n){
        const ov = pickOv(m, n.args, n.line);
        const codes = ov ? userArgs(ov.params, n.args, n.line) : n.args.map(a => argR(a).c);
        return { c: (m.static ? owner.js : recv) + '.' + (ov ? ov.js : m.js) + '(' + codes.join(', ') + ')', t: (ov || m.ovs[0]).ret, ucall: ov || m.ovs[0] };
      }
      function callFn(fd, js, n){ if (!arityOk(fd.params, n.args)) { const ps = fd.params; throw CsErr('Функция ' + fd.name + ' ждёт ' + ps.filter(p => !p.def && p.mod !== 'params').length + (ps.some(p => p.def) ? '–' + ps.length : '') + ' аргумент(ов), а передано ' + n.args.length, n.line); } return { c: js + '(' + userArgs(fd.params, n.args, n.line).join(', ') + ')', t: fd.ret, ucall: { async: fd.mods.has('async'), ret: fd.ret } }; }
      function arityOk(ps, args){
        if (args.some(a => a.name)) return args.every(a => !a.name || ps.some(p => p.name === a.name));
        const rest = ps.length && ps[ps.length - 1].mod === 'params';
        const req = ps.filter(p => !p.def && p.mod !== 'params').length, max = rest ? Infinity : ps.length;
        return args.length >= req && args.length <= max;
      }
      function quickType(e){
        switch (e.k) {
          case 'num': return e.nt === 'int' ? In : e.nt;
          case 'str': return St; case 'chr': return 'char'; case 'bool': return Bo; case 'istr': return St;
          case 'id': { const v = lookup(e.name); if (v) return v.type; if (FN && FN.cls) { const f = findMem(FN.cls, e.name); if (f && f.m.kind !== 'method') return f.m.type; } return null; }
          case 'new': return e.ty;
          case 'cast': return bare(e.ty);
          case 'un': return e.op === '-' ? quickType(e.e) : null;
        }
        return null;
      }
      function pickOv(m, args, line){
        const ovs = m.ovs, fits = ovs.filter(o => arityOk(o.params, args));
        if (ovs.length === 1) {
          if (!fits.length) { const ps = ovs[0].params; throw CsErr('Метод ' + m.name + ' ждёт ' + ps.filter(p => !p.def && p.mod !== 'params').length + (ps.some(p => p.def) ? '–' + ps.length : '') + ' аргумент(ов), а передано ' + args.length, line); }
          return ovs[0];
        }
        if (fits.length === 1) return fits[0];
        if (!fits.length) throw CsErr('Нет варианта метода ' + m.name + ' для ' + args.length + ' аргумент(ов)', line);
        const ts = args.map(a => a.name ? null : quickType(a.e));
        let best = null, bs = -1, tie = false;
        for (const o of fits) {
          let s = 0, ok = true;
          o.params.forEach((p, i) => {
            const at = bare(ts[i]), pt = bare(p.ty); if (!at || i >= ts.length) return;
            if (pt === at) s += 3; else if (isNumT(pt) && isNumT(at) && !(isIntT(pt) && !isIntT(at))) s += 1; else if (!isPrimT(pt) || !isPrimT(at)) s += 0; else ok = false;
          });
          if (ok && s > bs) { bs = s; best = o; tie = false; } else if (ok && s === bs) tie = true;
        }
        return tie ? null : best;
      }
      function userArgs(ps, args, line){
        const out = new Array(ps.length).fill(null), extra = [];
        const rest = ps.length && ps[ps.length - 1].mod === 'params' ? ps.length - 1 : -1;
        let pos = 0;
        for (const a of args) {
          let i;
          if (a.name) { i = ps.findIndex(p => p.name === a.name); if (i < 0) throw CsErr('Нет параметра «' + a.name + '»', a.line); }
          else i = pos++;
          if (rest >= 0 && i >= rest && !a.name) { extra.push(a); continue; }
          if (i >= ps.length) throw CsErr('Слишком много аргументов', a.line);
          out[i] = a;
        }
        const codes = [];
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          if (i === rest) {
            const et = elemT(p.ty);
            if (extra.length === 1 && extra[0].e.k !== 'lambda') { const R = ex(extra[0].e); if (isArrT(R.t) || isListT(R.t)) { codes.push('...' + R.c); continue; } codes.push(coerce(R, et)); continue; }
            for (const a of extra) codes.push(argR(a, et).c);
            continue;
          }
          const a = out[i];
          if (!a) { if (!p.def && p.mod !== 'params') throw CsErr('Не хватает аргумента «' + p.name + '»', line); codes.push('void 0'); continue; }
          const pr = p.mod === 'ref' || p.mod === 'out', ar = a.mod === 'ref' || a.mod === 'out';
          if (pr !== ar) throw CsErr(pr ? 'Аргумент «' + p.name + '» передаётся с ' + p.mod : 'Параметр «' + p.name + '» — без ' + a.mod, a.line);
          codes.push(argR(a, p.ty).c);
        }
        while (codes.length && codes[codes.length - 1] === 'void 0') codes.pop();
        return codes;
      }
      function apiFn(api, n, targs){
        const A = n.args, D = API[api];
        if (D.pr) return { c: api + '(' + A.map(a => strOf(ex(a.e))).join(', ') + ')', t: 'void' };
        if (api === 'random') return { c: 'random(' + A.map(a => argR(a).c).join(', ') + ')', t: A.length ? In : Fl };
        if (D.f === 'gen' || D.f === 'gen[]') {
          const ta = targs && targs[0]; if (ta) checkType(ta, n.line);
          return { c: api + '(' + (ta ? typeRef(ta) : A.map(a => argR(a).c).join(', ')) + ')', t: ta ? (D.f === 'gen[]' ? ta + '[]' : ta) : null };
        }
        return { c: api + '(' + A.map(a => argR(a).c).join(', ') + ')', t: D.f };
      }
      function apiStatic(api, name, n, targs){
        const sig = (API[api].s || {})[name];
        if (sig === undefined || !sig.endsWith('()')) throw CsErr(api + '.' + name + '(…) — такого метода нет' + hint(api, name), n.line);
        const A = n.args, c0 = api + '.' + name;
        if (((api === 'Debug' && /^Log(Warning|Error)?$/.test(name)) || api === 'Console') && A.length === 1) return { c: c0 + '(' + strOf(ex(A[0].e)) + ')', t: 'void' };
        if (api === 'Random' && name === 'Range' && A.length === 2) {
          const a = argR(A[0]), b = argR(A[1]), at = bare(a.t), bt = bare(b.t);
          if (isIntT(at) && isIntT(bt)) return { c: 'Random.RangeI(' + a.c + ', ' + b.c + ')', t: In };
          if (isNumT(at) || isNumT(bt)) return { c: 'Random.RangeF(' + a.c + ', ' + b.c + ')', t: Fl };
          return { c: 'Random.Range(' + a.c + ', ' + b.c + ')', t: null };
        }
        const outT = name === 'TryParse' ? sigRet(API[api].s.Parse) : null;
        const lh = (api === 'Array' && /^(Find|FindAll|FindIndex|Exists|TrueForAll|ForEach)$/.test(name)) ? 'arr' : null;
        let first = null;
        const R = A.map((a, i) => { const r = argR(a, a.mod === 'out' ? outT : a.e.k === 'lambda' && lh && first ? 'Func<' + (elemT(first.t) || 'object') + ',object>' : a.e.k === 'lambda' && (api === 'WaitUntil' || api === 'Task') ? null : null); if (i === 0) first = r; return r; });
        let t = sigRet(sig);
        if (t === 'num' || t === 'num2') t = R.length && R.every(r => isIntT(r.t)) ? In : t === 'num' ? Fl : 'double';
        else if (t === 'elem') t = R[0] ? elemT(R[0].t) : null;
        else if (t === 'arg0') t = R[0] ? R[0].t : null;
        else if (t === 'gen' || t === 'gen[]') { const ta = targs && targs[0]; if (ta) { checkType(ta, n.line); return { c: c0 + '(' + typeRef(ta) + ')', t: t === 'gen[]' ? ta + '[]' : ta }; } t = null; }
        if (api === 'MathF' && t === 'double') t = Fl;
        return { c: c0 + '(' + R.map(r => r.c).join(', ') + ')', t };
      }
      // ── new ──
      function hasBaseCtor(uc){ for (let b = baseOf(uc); b; b = baseOf(b)) if (b.ctors.length) return true; return false; }
      function newObj(n, want){
        let ty = n.ty;
        if (!ty) { if (!want || want === 'var' || want === 'object') throw CsErr('new() без типа: напиши тип слева (List<int> a = new();) или new Тип()', n.line); ty = want; }
        checkType(ty, n.line);
        const g = genName(ty), A = n.args || [], uc = userCls(ty);
        if (uc) {
          if (uc.kind === 'interface') throw CsErr('Нельзя создать интерфейс ' + uc.name, n.line);
          if (uc.abstract) throw CsErr('Нельзя создать абстрактный класс ' + uc.name, n.line);
          let codes;
          if (uc.ctors.length === 1) codes = userArgs(uc.ctors[0].fn.params, A, n.line);
          else { if (!uc.ctors.length && A.length && !hasBaseCtor(uc)) throw CsErr('У ' + uc.name + ' нет конструктора с параметрами', n.line); codes = A.map(a => argR(a).c); }
          let c = 'new ' + uc.js + '(' + codes.join(', ') + ')';
          if (n.init) c = initObj(c, n.init, uc);
          return { c, t: ty };
        }
        if (isEnumT(ty)) return { c: '0', t: ty };
        const ac = () => A.map(a => argR(a).c);
        switch (g) {
          case 'List': case 'IList': case 'IEnumerable': case 'ICollection': case 'IReadOnlyList': {
            const et = genArgs(ty)[0] || null, lt = 'List<' + (et || 'object') + '>';
            if (n.init) {
              if (n.init.kind !== 'coll') throw CsErr('Список заполняется так: new List<int> { 1, 2, 3 }', n.line);
              const items = '[' + n.init.items.map(it => mark(it.line) + coerce(ex(it.args[0], et), et)).join(', ') + ']';
              return { c: A.length ? '$.nl(' + ac()[0] + ').concat(' + items + ')' : items, t: lt };
            }
            return { c: A.length ? '$.nl(' + ac()[0] + ')' : '[]', t: lt };
          }
          case 'Dictionary': case 'IDictionary': case 'SortedDictionary': {
            USED.add('Dictionary');
            let c = 'new Dictionary(' + (A.length ? ac()[0] : '') + ')';
            if (n.init) c = '$.dinit(' + c + ', [' + n.init.items.map(it => {
              if (it.index) return mark(it.line) + '[' + ex(it.index[0]).c + ', ' + ex(it.e).c + ']';
              if (it.args && it.args.length === 2) return mark(it.line) + '[' + it.args.map(a => ex(a).c).join(', ') + ']';
              throw CsErr('Словарь заполняется так: { { "ключ", 1 }, { "ещё", 2 } } или { ["ключ"] = 1 }', it.line);
            }).join(', ') + '])';
            return { c, t: 'Dictionary<' + genArgs(ty).join(',') + '>' };
          }
          case 'HashSet': case 'Queue': case 'Stack': {
            USED.add(g);
            const et = genArgs(ty)[0] || null;
            let arg = A.length ? ac()[0] : '';
            if (n.init) arg = '[' + n.init.items.map(it => coerce(ex(it.args ? it.args[0] : it.e, et), et)).join(', ') + ']';
            return { c: 'new ' + g + '(' + arg + ')', t: ty };
          }
          case 'Vector3': USED.add('Vector3'); if (n.init) throw CsErr('Vector3 создаётся так: new Vector3(x, y, z)', n.line); return { c: 'new Vector3(' + ac().join(', ') + ')', t: V3 };
          case 'Color': case 'Color32': case 'Color3': USED.add(g); return { c: g + '.new(' + ac().join(', ') + ')', t: Co };
          case 'TweenInfo': USED.add('TweenInfo'); return { c: 'TweenInfo.new(' + ac().join(', ') + ')', t: 'TweenInfo' };
          case 'KeyValuePair': return { c: '$.kv(' + ac().join(', ') + ')', t: ty };
          case 'object': return { c: '({})', t: 'object' };
          case 'string': return { c: '$.srep(' + ac().join(', ') + ')', t: St };
          case 'Part': case 'BasePart': case 'Model': case 'Instance': case 'GameObject': case 'Transform':
            throw CsErr('Деталь создаётся так: Instance.new("Part", workspace) или Instantiate(образец)', n.line);
        }
        if (API[g] && API[g].type && (EXC.has(g) || ['Random', 'StringBuilder', 'WaitForSeconds', 'WaitForSecondsRealtime', 'WaitUntil', 'WaitWhile', 'WaitForEndOfFrame', 'WaitForFixedUpdate'].includes(g))) {
          USED.add(g);
          let c = 'new ' + g + '(' + A.map(a => argR(a, (g === 'WaitUntil' || g === 'WaitWhile') ? 'Func<bool>' : null).c).join(', ') + ')';
          if (n.init) c = initObj(c, n.init, null);
          return { c, t: ty };
        }
        throw CsErr('Нельзя создать ' + g + ' через new', n.line);
      }
      function initObj(c, init, uc){
        const parts = init.items.map(it => {
          if (init.kind === 'coll') return mark(it.line) + '$o.Add(' + it.args.map(a => ex(a).c).join(', ') + ')';
          if (it.index) return mark(it.line) + '$.sx($o, ' + ex(it.index[0]).c + ', ' + ex(it.e).c + ')';
          if (uc) {
            const f = findMem(uc, it.name);
            if (!f || f.m.kind === 'method') throw CsErr('У ' + uc.name + ' нет поля или свойства «' + it.name + '»', it.line);
            return mark(it.line) + '$o.' + f.m.js + ' = ' + coerce(ex(it.e, f.m.type), f.m.type);
          }
          return mark(it.line) + '$o.' + it.name + ' = ' + ex(it.e).c;
        });
        return '$.ini(' + c + ', $o => { ' + parts.join('; ') + '; })';
      }
      function newArr(n){
        const et = n.ty;
        if (et) checkType(et, n.line);
        if (n.init) return arrItems(n.init, et, n.rank, n.line);
        const S = n.sizes.map(s => coerce(ex(s), In));
        if (n.rank === 1) return { c: isStructT(et) ? '$.arrf(' + S[0] + ', () => ' + defCode(et) + ')' : '$.arr(' + S[0] + ', ' + defCode(et) + ')', t: et + '[]' };
        if (n.rank === 2) return { c: '$.arr2(' + S[0] + ', ' + S[1] + ', ' + defCode(et) + ')', t: et + '[,]' };
        throw CsErr('Массивы больше двух измерений не поддерживаются', n.line);
      }
      function arrItems(init, et, rank, line){
        if (rank > 1) {
          const rows = init.items.map(r => { if (r.k !== 'arrinit') throw CsErr('Двумерный массив: { { 1, 2 }, { 3, 4 } }', line); return arrItems(r, et, rank - 1, line); });
          return { c: '[' + rows.map(r => r.c).join(', ') + ']', t: (et || (rows[0] && elemT(rows[0].t)) || 'object') + '[' + ','.repeat(rank - 1) + ']' };
        }
        const Rs = init.items.map(x => x.k === 'arrinit' ? arrItems(x, et ? elemT(et) : null, 1, line) : ex(x, et));
        let t = et;
        if (!t) for (const R of Rs) { if (R.isNull) continue; if (!t) t = R.t; else if (isNumT(t) && isNumT(R.t) && bare(t) !== bare(R.t)) t = numT(t, R.t); }
        return { c: '[' + Rs.map((R, i) => (init.items[i].line ? mark(init.items[i].line) : '') + coerce(R, t)).join(', ') + ']', t: (t || 'object') + '[]' };
      }
      function collLit(n, want){
        const g = genName(want), et = elemT(want);
        const items = n.items.map(x => coerce(ex(x, et), et));
        if (g === 'HashSet' || g === 'Queue' || g === 'Stack') { USED.add(g); return { c: 'new ' + g + '([' + items.join(', ') + '])', t: want }; }
        if (isDictT(want)) throw CsErr('Словарь так не создать — используй new Dictionary<K, V> { … }', n.line);
        return { c: '[' + items.join(', ') + ']', t: want && isListT(want) ? want : (et || 'object') + '[]' };
      }
      // ── лямбды: x => …, (a, b) => { … }, async () => … ──
      function lambdaX(n, want){
        const dp = delParams(want) || [], save = [FN, SC, PEND, BRK];
        const up = FN;
        FN = { kind: 'lambda', up, root: up ? up.root : null, cls: up ? up.cls : null, isStatic: up ? up.isStatic : true, self: up ? up.self : null,
          async: !!n.async, gen: false, ret: delRet(want), params: new Set(), tps: up && up.tps };
        if (!FN.root) FN.root = FN;
        BRK = [];
        push();
        const many = n.params.filter(p => p.name === '_').length > 1;
        const ps = n.params.map((p, i) => {
          if (p.ty) checkType(p.ty, n.line);
          if (many && p.name === '_') return '$_' + i;
          const v = declare(p.name, p.ty || dp[i] || null, n.line, { param: true, ref: p.mod === 'ref' || p.mod === 'out' });
          FN.params.add(p.name);
          return v.js;
        });
        let body, bt = null;
        const rt = FN.ret && FN.ret !== 'void' && FN.ret !== 'object' ? FN.ret : null;
        if (n.body.s === 'block') body = fnBlock(n.body, '');
        else {
          PEND = [];
          const R = ex(n.body, rt);
          bt = R.t;
          const c = rt ? coerce(R, rt) : R.c;
          body = PEND.length ? '{ let ' + [...new Set(PEND)].join(', ') + '; ' + lead('return ', c) + '; }' : '(' + c + ')';
        }
        pop();
        [FN, SC, PEND, BRK] = save;
        return { c: '(' + (n.async ? 'async ' : '') + '(' + ps.join(', ') + ') => ' + body + ')', t: want || 'delegate', bt };
      }

      // ── инструкции ──
      let CATCH = [];
      const WRAP = new Set(['while', 'do', 'for', 'foreach', 'switch', 'using', 'lock']);
      function hasYield(b){
        let y = false;
        const walk = s => {
          if (!s || y) return;
          if (Array.isArray(s)) { s.forEach(walk); return; }
          switch (s.s) {
            case 'yret': case 'ybrk': y = true; return;
            case 'block': walk(s.body); return;
            case 'if': walk(s.a); walk(s.b); return;
            case 'while': case 'do': case 'for': case 'foreach': case 'lock': case 'using': walk(s.body); return;
            case 'switch': s.secs.forEach(x => walk(x.body)); return;
            case 'try': walk(s.body); s.catches.forEach(k => walk(k.body)); walk(s.fin); return;
          }
        };
        walk(b);
        return y;
      }
      function stmtCode(s, emb){
        const saveP = PEND, saveL = STL; PEND = []; STL = s.line;
        const code = stmtInner(s);
        STL = saveL;
        const names = [...new Set(PEND)];
        PEND = saveP;
        const decl = names.length ? 'let ' + names.join(', ') + '; ' : '';
        if (decl && (WRAP.has(s.s) || emb)) return mark(s.line) + '{' + decl + code + '}';
        if (emb && (s.s === 'var' || s.s === 'func' || s.s === 'decon')) return mark(s.line) + '{' + code + '}';
        return mark(s.line) + decl + code;
      }
      function hoist(list){
        for (const s of list) if (s.s === 'func') { if (SC.v.has(s.fn.name)) throw CsErr('«' + s.fn.name + '» уже объявлено', s.line); declare(s.fn.name, 'delegate', s.line, { kind: 'func', fn: s.fn }); }
      }
      function blockCode(b){ push(); hoist(b.body); const c = b.body.map(s => stmtCode(s)).join(''); pop(); return '{' + c + mark(b.end) + '}'; }
      function fnBlock(b, pro){ hoist(b.body); return '{' + pro + b.body.map(s => stmtCode(s)).join('') + mark(b.end) + '}'; }
      function stmtInner(s){
        switch (s.s) {
          case 'block': return blockCode(s);
          case 'empty': return ';';
          case 'var': return varCode(s) + ';';
          case 'func': return localFunc(s.fn);
          case 'expr': return exprStmt(s.e) + ';';
          case 'decon': {
            const R = ex(s.e), els = isTupleT(R.t) ? tupleEls(R.t) : [];
            const vs = s.names.map((nm, i) => nm ? declare(nm, els[i] ? els[i].t : null, s.line).js : '');
            return 'let [' + vs.join(', ') + '] = $.dc(' + R.c + ');';
          }
          case 'if': return 'if (' + condCode(s.c) + ') ' + stmtCode(s.a, true) + (s.b ? ' else ' + stmtCode(s.b, true) : '');
          case 'while': { push(); const c = condCode(s.c); BRK.push('loop'); const b = stmtCode(s.body, true); BRK.pop(); pop(); return 'while (' + c + ') ' + b; }
          case 'do': { push(); BRK.push('loop'); const b = stmtCode(s.body, true); BRK.pop(); const c = condCode(s.c); pop(); return 'do ' + b + ' while (' + c + ');'; }
          case 'for': {
            push();
            const init = Array.isArray(s.init) ? s.init.map(e => ex(e).c).join(', ') : s.init ? varCode(s.init) : '';
            const c = s.c ? condCode(s.c) : '', it = s.it.map(e => ex(e).c).join(', ');
            BRK.push('loop'); const b = stmtCode(s.body, true); BRK.pop();
            pop();
            return 'for (' + init + '; ' + c + '; ' + it + ') ' + b;
          }
          case 'foreach': return foreachCode(s);
          case 'switch': return switchCode(s);
          case 'break': { if (!BRK.length) throw CsErr('break — только в цикле или switch', s.line); const top = BRK[BRK.length - 1]; return top === 'loop' || top === 'switch' ? 'break;' : 'break ' + top + ';'; }
          case 'continue': if (!BRK.includes('loop')) throw CsErr('continue — только в цикле', s.line); return 'continue;';
          case 'return': {
            if (FN.gen) { if (s.e) throw CsErr('В корутине (IEnumerator) вместо return значение пиши yield break', s.line); return 'return;'; }
            if (!s.e) return 'return;';
            if (FN.kind === 'ctor' || FN.kind === 'sctor' || (FN.ret === 'void' && !FN.async && (FN.kind === 'method' || FN.kind === 'local'))) throw CsErr('Метод void ничего не возвращает: пиши просто return;', s.line);
            const t = FN.async ? taskRes(FN.ret) : FN.ret, R = ex(s.e, t && t !== 'void' && t !== 'object' ? t : null);
            return lead('return ', t && t !== 'void' && t !== 'object' ? coerce(R, t) : R.c) + ';';
          }
          case 'throw':
            if (!s.e) { if (!CATCH.length) throw CsErr('throw; — только внутри catch', s.line); return 'throw ' + CATCH[CATCH.length - 1] + ';'; }
            return lead('throw ', ex(s.e).c) + ';';
          case 'try': return tryCode(s);
          case 'yret': if (!FN.gen) throw CsErr('yield return — только в методе IEnumerator (корутине)', s.line); return lead('yield ', ex(s.e).c) + ';';
          case 'ybrk': if (!FN.gen) throw CsErr('yield break — только в методе IEnumerator (корутине)', s.line); return 'return;';
          case 'using': {
            push();
            let head, nm;
            if (s.decl) { head = varCode(s.decl) + ';'; nm = lookup(s.decl.decls[0].name).js; }
            else { nm = '$u' + (++TMP); head = 'const ' + nm + ' = ' + ex(s.e).c + ';'; }
            const b = stmtCode(s.body, true);
            pop();
            return '{' + head + ' try {' + b + '} finally { $.disp(' + nm + '); }}';
          }
          case 'lock': ex(s.e); return stmtCode(s.body, true);
        }
        throw CsErr('Эта инструкция не поддерживается', s.line);
      }
      function varCode(s){
        const isVar = s.ty === 'var';
        if (!isVar) checkType(s.ty, s.line);
        const parts = s.decls.map(d => {
          let t = isVar ? null : s.ty, init;
          if (d.init) {
            const R = d.init.k === 'arrinit' ? arrItems(d.init, elemT(t), rankOf(t) || 1, d.line) : ex(d.init, t);
            if (R.ty || R.ns) throw CsErr('Это тип, а не значение', d.line);
            if (R.t === 'void') throw CsErr('Метод ничего не возвращает (void) — его результат нельзя сохранить', d.line);
            if (isVar) { if (R.isNull) throw CsErr('var x = null — так нельзя: напиши тип (string x = null;)', d.line); t = R.t; }
            init = coerce(R, t);
          } else { if (isVar) throw CsErr('У var нужно значение: var x = …;', d.line); init = defCode(t); }
          const v = declare(d.name, t, d.line, { isConst: !!s.isConst });
          return mark(d.line) + v.js + ' = ' + init;
        });
        return (s.isConst ? 'const ' : 'let ') + parts.join(', ');
      }
      function exprStmt(e){
        const ok = ['asg', 'call', 'post', 'await', 'new'].includes(e.k) || (e.k === 'un' && (e.op === '++' || e.op === '--'));
        if (!ok) {
          if (e.k === 'bin' && e.op === '==') throw CsErr('a == b ничего не делает — может, имелось в виду присваивание a = b?', e.line);
          if (e.k === 'id' || e.k === 'mem') throw CsErr('Одно имя — не инструкция: может, забыты скобки () у вызова метода?', e.line);
          throw CsErr('Это выражение ничего не делает — инструкцией может быть вызов, присваивание, ++ или --', e.line);
        }
        // v.Normalize(); v.Set(x, y, z); — Vector3 неизменяемый: присваиваем новый
        if (e.k === 'call' && e.f.k === 'mem' && !e.f.cond && isLvNode(e.f.o) && ((e.f.name === 'Normalize' && !e.args.length) || (e.f.name === 'Set' && e.args.length === 3))) {
          const qt = bare(ex(e.f.o).t);
          if (qt === V3 || !qt) {
            const pre = [], L = lval(e.f.o, pre);
            USED.add('Vector3');
            return seq(pre, L.set(e.f.name === 'Normalize' ? '$.vnorm(' + L.get + ')' : '$.vset(' + L.get + ', ' + e.args.map(a => ex(a.e).c).join(', ') + ')'));
          }
        }
        if (e.k === 'post') e = { k: 'un', op: e.op, e: e.e, line: e.line };   // x++; как инструкция = ++x
        const R = ex(e);
        let c = R.c;
        if (e.k === 'call' && R.ucall && R.ucall.async && /^Task/.test(R.ucall.ret || '')) c = '$.fire(' + c + ')';
        if (/^(\{|function\b|class\b|let\b|async\s+function)/.test(c)) c = '(' + c + ')';
        return c;
      }
      function foreachCode(s){
        const C = ex(s.coll);
        if (s.ty) checkType(s.ty, s.line);
        const et = s.ty || elemT(C.t);
        push(); BRK.push('loop');
        let head, pro = '';
        if (s.names) {
          const ev = '$f' + (++TMP), kv = genName(et) === 'KeyValuePair' ? genArgs(et) : isTupleT(et) ? tupleEls(et).map(x => x.t) : [];
          const vs = s.names.map((nm, i) => nm ? declare(nm, kv[i] || null, s.line).js : '');
          head = 'for (const ' + ev + ' of $.it(' + C.c + ')) ';
          pro = 'const [' + vs.join(', ') + '] = $.dc(' + ev + '); ';
        } else head = 'for (const ' + declare(s.name, et, s.line, { fe: true }).js + ' of $.it(' + C.c + ')) ';
        const b = stmtCode(s.body, true);
        BRK.pop(); pop();
        return head + '{' + pro + b + '}';
      }
      function switchCode(s){
        const R = ex(s.e);
        if (s.secs.every(sec => sec.labels.every(l => !l.when && (!l.pat || constPat(l.pat))))) {
          BRK.push('switch'); push();
          let out = 'switch (' + R.c + ') {';
          for (const sec of s.secs) {
            for (const l of sec.labels) out += mark(l.line) + (l.pat ? 'case ' + (l.pat.p === 'null' ? 'null' : ex(l.pat.e).c) + ':' : 'default:');
            out += ' {' + sec.body.map(st => stmtCode(st)).join('') + '}';
          }
          pop(); BRK.pop();
          return out + '}';
        }
        const lab = '$s' + (++TMP), sv = '$v' + TMP;
        BRK.push(lab); push();
        let out = lab + ': { const ' + sv + ' = ' + R.c + '; ', dflt = null, first = true;
        for (const sec of s.secs) {
          const conds = [];
          let isDef = false;
          for (const l of sec.labels) {
            if (!l.pat) { isDef = true; continue; }
            let c = patCode(l.pat, sv, R.t, l.line);
            if (l.when) c = '(' + c + ' && ' + condCode(l.when) + ')';
            conds.push(mark(l.line) + c);
          }
          const body = '{' + sec.body.map(st => stmtCode(st)).join('') + '}';
          if (isDef) { dflt = body; continue; }
          out += (first ? '' : 'else ') + 'if (' + conds.join(' || ') + ') ' + body + ' ';
          first = false;
        }
        if (dflt) out += (first ? '' : 'else ') + dflt;
        pop(); BRK.pop();
        return out + '}';
      }
      function tryCode(s){
        let c = 'try ' + blockCode(s.body);
        if (s.catches.length) {
          const ev = '$e' + (++TMP), lab = '$k' + TMP;
          CATCH.push(ev);
          let inner = '', all = false;
          for (const k of s.catches) {
            push();
            let cond = null, bind = '';
            if (k.ty) {
              checkType(k.ty, k.line);
              if (genName(k.ty) !== 'Exception') cond = '$.isExc(' + ev + ', ' + typeRef(k.ty) + ')';
              if (k.name) bind = 'const ' + declare(k.name, k.ty, k.line).js + ' = ' + ev + '; ';
            }
            if (k.when) { const w = condCode(k.when); cond = cond ? cond + ' && ' + w : w; }
            const body = blockCode(k.body);
            pop();
            inner += mark(k.line) + '{' + bind + (cond ? 'if (' + cond + ') ' : '') + '{' + body + ' break ' + lab + '; }} ';
            if (!cond) { all = true; break; }
          }
          CATCH.pop();
          c += ' catch (' + ev + ') { $.exc(' + ev + '); ' + lab + ': { ' + inner + (all ? '' : 'throw ' + ev + '; ') + '} }';
        }
        if (s.fin) c += ' finally ' + blockCode(s.fin);
        return c;
      }
      // ── функции: методы, локальные функции, конструкторы, свойства ──
      function funcCode(fd, ctx){
        const save = [FN, SC, PEND, BRK, CATCH], up = FN;
        FN = Object.assign({ up, params: new Set(), needSelf: false, awaits: 0 }, ctx);
        FN.root = ctx.kind === 'local' && up ? up.root : FN;
        BRK = []; CATCH = [];
        push();
        if (ctx.ret && ctx.ret !== 'void') checkType(ctx.ret, fd.line);
        const ps = fd.params.map(p => {
          checkType(p.ty, p.line || fd.line);
          const v = declare(p.name, p.ty, p.line || fd.line, { param: true, ref: p.mod === 'ref' || p.mod === 'out' });
          FN.params.add(p.name);
          if (p.mod === 'params') return '...' + v.js;
          if (p.def) return v.js + ' = ' + coerce(ex(p.def, p.ty), p.ty);
          return v.js;
        });
        const head = ctx.pre ? ctx.pre() : '';
        let inner = '', end = fd.line;
        if (fd.body) { hoist(fd.body.body); inner = fd.body.body.map(s => stmtCode(s)).join(''); end = fd.body.end; }
        else if (fd.ex) {
          PEND = [];
          const t = ctx.async ? taskRes(ctx.ret) : ctx.ret, val = t && t !== 'void';
          const R = ex(fd.ex, val ? t : null);
          const dl = PEND.length ? 'let ' + [...new Set(PEND)].join(', ') + '; ' : '';
          inner = mark(fd.ex.line || fd.line) + dl + (val ? lead('return ', coerce(R, t)) : R.c) + ';';
        }
        let pro = FN.root === FN && FN.needSelf ? 'const $self = this; ' : '';
        for (const p of fd.params) if (isStructT(p.ty) && p.mod !== 'ref' && p.mod !== 'out' && p.mod !== 'params') pro += jsName(p.name) + ' = $.cl(' + jsName(p.name) + '); ';
        const body = ctx.async && ctx.ret === 'void' ? 'try {' + inner + '} catch ($e) { $.rep($e); }' : inner;
        pop();
        [FN, SC, PEND, BRK, CATCH] = save;
        return { ps: ps.join(', '), body: '{' + head + pro + body + mark(end) + '}' };
      }
      function localFunc(fd){
        const v = lookup(fd.name);
        const isGen = !!fd.body && hasYield(fd.body), isAsync = fd.mods.has('async');
        if (isGen && isAsync) throw CsErr('async и yield вместе не поддерживаются', fd.line);
        if (isGen && !/^(IEnumerator|IEnumerable)(<|$)/.test(fd.ret)) throw CsErr('yield return — только в функции, которая возвращает IEnumerator (корутина)', fd.line);
        const r = funcCode(fd, { kind: 'local', cls: FN ? FN.cls : null, isStatic: FN ? FN.isStatic : true, self: FN && FN.self ? '$self' : null, async: isAsync, gen: isGen, ret: fd.ret, tps: (FN && FN.tps || []).concat(fd.tps || []) });
        return (isAsync ? 'async ' : '') + 'function' + (isGen ? '*' : '') + ' ' + v.js + '(' + r.ps + ') ' + r.body;
      }
      const ctxOf = (c, st) => ({ kind: 'method', cls: c, isStatic: st, self: st ? null : 'this', tps: c.d.tps || [], async: false, gen: false, ret: 'void' });
      function initCode(c, ty, x, st, line){   // значение поля / автосвойства
        const save = [FN, SC, PEND];
        FN = Object.assign({ up: null, params: new Set(), awaits: 0 }, ctxOf(c, st), { kind: 'field', ret: null });
        FN.root = FN;
        push(); PEND = [];
        let init = x ? coerce(x.k === 'arrinit' ? arrItems(x, elemT(ty), rankOf(ty) || 1, line) : ex(x, ty), ty) : defCode(ty);
        if (PEND.length) init = '(() => { let ' + [...new Set(PEND)].join(', ') + '; return ' + init + '; })()';
        pop(); [FN, SC, PEND] = save;
        return init;
      }
      function classCode(c){
        const d = c.d;
        let ext = '';
        if (c.base) ext = ' extends ' + baseOf(c).js;
        else if (c.script) ext = ' extends $.Script';
        else if (c.excBase) { USED.add(c.excBase); ext = ' extends ' + c.excBase; }
        let out = mark(d.line) + 'class ' + c.js + ext + ' {';
        for (const m of d.members) {
          if (m.m === 'field') {
            checkType(m.ty, m.line);
            const st = m.mods.has('static') || !!m.isConst;
            for (const x of m.decls) out += mark(x.line) + (st ? 'static ' : '') + c.mem.get(x.name).js + ' = ' + (x.init ? initCode(c, m.ty, x.init, st, x.line) : m.isEvent ? 'null' : defCode(m.ty)) + ';';
          }
          else if (m.m === 'prop') out += mark(m.line) + propCode(c, m);
          else if (m.m === 'method') out += methodCode(c, m.fn);
          else if (m.m === 'op') { const r = funcCode(m.fn, Object.assign(ctxOf(c, true), { ret: m.fn.ret })); out += mark(m.line) + 'static ' + OPN[m.op] + '(' + r.ps + ') ' + r.body; }
          else if (m.m === 'indexer') out += indexerCode(c, m);
          else if (m.m === 'sctor') { const r = funcCode(m.fn, Object.assign(ctxOf(c, true), { kind: 'sctor' })); out += mark(m.line) + 'static ' + r.body; }
        }
        out += ctorCode(c);
        for (const mm of c.mem.values()) if (mm.kind === 'method' && mm.ovs.length > 1)
          out += (mm.static ? 'static ' : '') + mm.js + '(...$a) { return this[' + JSON.stringify(mm.js + '$') + ' + $.ovk($a, ' + sigsCode(mm.ovs) + ', ' + JSON.stringify(mm.name) + ')](...$a); }';
        const ts = c.mem.get('ToString');
        if (ts && ts.kind === 'method' && !ts.static) out += 'toString() { return this.ToString(); }';
        if (c.allIfaces && c.allIfaces.length) out += 'static $ifc = ' + JSON.stringify(c.allIfaces) + ';';
        return out + mark(d.end) + '}';
      }
      function propCode(c, m){
        checkType(m.ty, m.line);
        const st = m.mods.has('static'), js = c.mem.get(m.name).js, pre = st ? 'static ' : '', g = m.acc.get, s = m.acc.set;
        if ((g && g.auto) || (!g && s && s.auto)) return pre + js + ' = ' + (m.init ? initCode(c, m.ty, m.init, st, m.line) : defCode(m.ty)) + ';';
        let out = '';
        if (g) {
          const fd = { params: [], body: g.body || null, ex: g.ex || null, line: g.line, mods: new Set() }, gen = !!(g.body && hasYield(g.body));
          const r = funcCode(fd, Object.assign(ctxOf(c, st), { ret: m.ty, gen }));
          out += mark(g.line) + pre + 'get ' + js + '() ' + r.body;
        }
        if (s) {
          const fd = { params: [{ name: 'value', ty: m.ty, line: s.line }], body: s.body || null, ex: s.ex || null, line: s.line, mods: new Set() };
          const r = funcCode(fd, ctxOf(c, st));
          out += mark(s.line) + pre + 'set ' + js + '(' + r.ps + ') ' + r.body;
        }
        return out;
      }
      function methodCode(c, f){
        const mm = c.mem.get(f.name), ov = mm.ovs.find(o => o.fn === f);
        if (!f.body && !f.ex) return '';
        const st = f.mods.has('static'), as = f.mods.has('async');
        if (as && ov.gen) throw CsErr('async и yield вместе не поддерживаются', f.line);
        if (ov.gen && !/^(IEnumerator|IEnumerable)(<|$)/.test(f.ret)) throw CsErr('yield return — только в методе, который возвращает IEnumerator (корутина)', f.line);
        const r = funcCode(f, Object.assign(ctxOf(c, st), { async: as, gen: ov.gen, ret: f.ret, tps: (c.d.tps || []).concat(f.tps || []) }));
        return mark(f.line) + (st ? 'static ' : '') + (as ? 'async ' : '') + (ov.gen ? '*' : '') + ov.js + '(' + r.ps + ') ' + r.body;
      }
      function indexerCode(c, m){
        let out = '';
        const g = m.acc.get, s = m.acc.set;
        if (g) { const r = funcCode({ params: m.params, body: g.body || null, ex: g.ex || null, line: g.line, mods: new Set() }, Object.assign(ctxOf(c, false), { ret: m.ty })); out += mark(g.line) + '$get(' + r.ps + ') ' + r.body; }
        if (s) { const r = funcCode({ params: m.params.concat([{ name: 'value', ty: m.ty, line: s.line }]), body: s.body || null, ex: s.ex || null, line: s.line, mods: new Set() }, ctxOf(c, false)); out += mark(s.line) + '$set(' + r.ps + ') ' + r.body; }
        return out;
      }
      const sigT = t => { t = bare(t); const uc = userCls(t); if (uc && uc.kind !== 'interface') return uc.js; if (['int', 'float', 'double', 'decimal', 'string', 'bool', 'char'].includes(t)) return JSON.stringify(t); if (t === V3) return '"Vector3"'; return '"*"'; };
      const sigsCode = ovs => '[' + ovs.map(o => { const ps = o.params, rest = ps.length && ps[ps.length - 1].mod === 'params'; return '[' + ps.filter(p => !p.def && p.mod !== 'params').length + ', ' + (rest ? 99 : ps.length) + ', [' + ps.map(p => sigT(p.ty)).join(', ') + ']]'; }).join(', ') + ']';
      function ctorCode(c){
        const cs = c.ctors, hasBase = !!(c.base || c.script || c.excBase);
        if (!cs.length) return '';
        const bc = baseOf(c);
        const baseArgs = (k, line) => {   // аргументы конструктора базового класса
          const a = k.init && k.init.kind === 'base' ? k.init.args : [];
          if (c.script && a.length) throw CsErr('У Script конструктор без параметров: base()', line);
          return bc && bc.ctors.length === 1 ? userArgs(bc.ctors[0].fn.params, a, line) : a.map(x => argR(x).c);
        };
        if (cs.length === 1) {
          const k = cs[0];
          if (k.init && k.init.kind === 'this') throw CsErr('this(…) — нужен второй конструктор', k.line);
          if (k.init && k.init.kind === 'base' && !hasBase) throw CsErr('base(…) — у класса нет базового класса', k.line);
          const r = funcCode(k.fn, Object.assign(ctxOf(c, false), { kind: 'ctor', pre: () => hasBase ? 'super(' + baseArgs(k, k.line).join(', ') + '); ' : '' }));
          return mark(k.line) + 'constructor(' + r.ps + ') ' + r.body;
        }
        const ov = { name: c.name, ovs: cs.map((k, i) => ({ fn: k.fn, params: k.fn.params, js: '$c' + i, i })) };
        let out = '';
        cs.forEach((k, i) => {
          const ch = k.init && k.init.kind === 'this' ? k.init : null;
          let tgt = null;
          if (ch) { tgt = pickOv(ov, ch.args, k.line); if (!tgt) throw CsErr('Не удалось выбрать конструктор для this(…)', k.line); if (tgt.i === i) throw CsErr('Конструктор вызывает сам себя', k.line); }
          const r = funcCode(k.fn, Object.assign(ctxOf(c, false), { kind: 'ctor', pre: () => tgt ? 'this.$c' + tgt.i + '(' + userArgs(tgt.params, ch.args, k.line).join(', ') + '); ' : '' }));
          out += mark(k.line) + '$c' + i + '(' + r.ps + ') ' + r.body;
          if (hasBase) {
            const rb = funcCode({ params: k.fn.params, body: null, ex: null, line: k.line, mods: new Set() }, Object.assign(ctxOf(c, true), { pre: () => 'return ' + (tgt ? c.js + '.$b' + tgt.i + '(' + userArgs(tgt.params, ch.args, k.line).join(', ') + ')' : '[' + baseArgs(k, k.line).join(', ') + ']') + ';' }));
            out += 'static $b' + i + '(' + rb.ps + ') ' + rb.body;
          }
        });
        return out + 'constructor(...$a) { const $k = $.ovk($a, ' + sigsCode(ov.ovs) + ', ' + JSON.stringify(c.name) + '); ' + (hasBase ? 'super(...' + c.js + '["$b" + $k](...$a)); ' : '') + 'this["$c" + $k](...$a); }';
      }
      function enumCode(c){
        const d = c.d, save = [FN, PEND];
        FN = { kind: 'enum', up: null, async: false, gen: false, isStatic: true, self: null, cls: null, params: new Set(), awaits: 0 }; FN.root = FN;
        push(); PEND = [];
        let out = mark(d.line) + 'const ' + c.js + ' = $.enm(' + JSON.stringify(c.name) + ', $e => {', prev = null;
        for (const it of d.items) {
          const v = it.e ? coerce(ex(it.e), In) : prev === null ? '0' : '$e.' + prev + ' + 1';
          out += mark(it.line) + '$e.' + it.name + ' = ' + v + ';';
          SC.v.set(it.name, { type: c.name, js: '$e.' + it.name, isConst: true, name: it.name });
          prev = it.name;
        }
        pop(); [FN, PEND] = save;
        return out + mark(d.end) + '});';
      }
      const msgMeta = c => { const meta = {}; for (const nm of MSGS) { const f = findMem(c, nm); if (f && f.m.kind === 'method' && !f.m.static) { const o = f.m.ovs[0]; meta[nm] = [o.params.length, o.params[0] ? genName(o.params[0].ty) : null]; } } return meta; };
      const mjs = n => n === 'constructor' || n === 'prototype' ? n + '$' : n;
      function collect(d, outer){
        if (CL.has(d.name)) throw CsErr('Тип «' + d.name + '» объявлен дважды', d.line);
        const c = { d, name: d.name, js: jsName(d.name), kind: d.kind, outer, mem: new Map(), ctors: [], ops: {}, base: null, script: false, ifaces: [], indexer: null,
          abstract: !!(d.mods && d.mods.has('abstract')) };
        CL.set(d.name, c);
        for (const t of d.tps || []) TPS.add(t);
        if (d.kind === 'enum') { for (const it of d.items) { if (c.mem.has(it.name)) throw CsErr('«' + it.name + '» уже есть в ' + d.name, it.line); c.mem.set(it.name, { kind: 'enumv', js: it.name, static: true, type: d.name, name: it.name }); } return; }
        if (d.kind === 'delegate') return;
        const add = (name, m, line) => { if (c.mem.has(name)) throw CsErr('«' + name + '» уже объявлен в ' + d.name, line); m.name = name; m.js = mjs(name); c.mem.set(name, m); };
        for (const m of d.members) {
          if (m.m === 'type') collect(m.decl, c);
          else if (m.m === 'field') for (const x of m.decls) add(x.name, { kind: m.isEvent ? 'event' : 'field', type: m.ty, static: m.mods.has('static') || !!m.isConst, isConst: !!m.isConst }, x.line);
          else if (m.m === 'prop') add(m.name, { kind: 'prop', type: m.ty, static: m.mods.has('static') }, m.line);
          else if (m.m === 'method') {
            const f = m.fn, e = c.mem.get(f.name);
            for (const t of f.tps || []) TPS.add(t);
            const ov = { fn: f, params: f.params, ret: f.ret, static: f.mods.has('static'), async: f.mods.has('async'), gen: !!f.body && hasYield(f.body) };
            if (e && e.kind === 'method') { if (ov.static !== e.static) throw CsErr('Варианты метода «' + f.name + '» должны быть все static или все нет', f.line); e.ovs.push(ov); }
            else add(f.name, { kind: 'method', ovs: [ov], static: ov.static }, f.line);
          }
          else if (m.m === 'ctor') c.ctors.push(m);
          else if (m.m === 'op') { if (!OPN[m.op]) throw CsErr('Оператор ' + m.op.replace(/^u/, '') + ' перегружать нельзя', m.line); if (c.ops[m.op]) throw CsErr('Оператор ' + m.op.replace(/^u/, '') + ' уже объявлен', m.line); c.ops[m.op] = m; }
          else if (m.m === 'indexer') c.indexer = m;
        }
        for (const mm of c.mem.values()) if (mm.kind === 'method') mm.ovs.forEach((o, i) => { o.js = mm.ovs.length > 1 ? mm.js + '$' + i : mm.js; });
      }

      // ── сборка ──
      return function run(lastLine){
        for (const d of U.types) collect(d, null);
        for (const c of CL.values()) {
          if (c.kind !== 'class' && c.kind !== 'struct' && c.kind !== 'interface') continue;
          for (const b of c.d.bases) {
            const g = genName(b), bc = clsOf(g);
            if (['Script', 'MonoBehaviour', 'Behaviour', 'NetworkBehaviour'].includes(g) && !bc) { if (c.kind !== 'class') throw CsErr('От Script наследуются только классы', c.d.line); c.script = true; continue; }
            if (bc && bc.kind === 'class' && c.kind === 'class') { if (c.base) throw CsErr('У класса может быть только один базовый класс', c.d.line); c.base = g; c.baseC = bc; continue; }
            if (bc && bc.kind === 'interface') { c.ifaces.push(g); continue; }
            if (EXC.has(g)) { if (c.kind !== 'class') throw CsErr('Исключение — это class', c.d.line); c.excBase = g; c.exc = true; continue; }
            if (TYPES.has(g) || /^I[A-Z]/.test(g)) continue;
            if (NOPE[g]) throw CsErr(g + ': ' + NOPE[g], c.d.line);
            throw Object.assign(CsErr('Базовый тип «' + g + '» не найден', c.d.line), { unk: true });
          }
        }
        for (const c of CL.values()) {
          const seen = new Set();
          for (let b = c; b; b = baseOf(b)) { if (seen.has(b)) throw CsErr('Класс ' + c.name + ' наследует сам себя', c.d.line); seen.add(b); if (b.exc) c.exc = true; }
          const all = new Set(), add = n => { if (all.has(n)) return; all.add(n); const ic = clsOf(n); if (ic && ic.d.bases) for (const b of ic.d.bases) { const bc = clsOf(genName(b)); if (bc && bc.kind === 'interface') add(bc.name); } };
          for (let b = c; b; b = baseOf(b)) (b.ifaces || []).forEach(add);
          c.allIfaces = [...all];
        }
        SC = null; FN = null; push();
        const out = [];
        for (const c of CL.values()) if (c.kind === 'enum') out.push(enumCode(c));
        let main = 'null';
        if (U.stmts.length) {
          FN = { kind: 'main', up: null, async: true, gen: false, isStatic: true, self: null, cls: null, params: new Set(), ret: null, awaits: 0 }; FN.root = FN;
          BRK = []; CATCH = [];
          push(); hoist(U.stmts);
          const body = U.stmts.map(s => stmtCode(s)).join('');
          pop(); FN = null;
          out.push(mark(U.stmts[0].line) + 'async function $main() {' + body + '}');
          main = '$main';
        }
        const done = new Set(), order = [];
        const visit = c => { if (done.has(c)) return; done.add(c); const bb = baseOf(c); if (bb && !bb.ext) visit(bb); order.push(c); };
        for (const c of CL.values()) if (c.kind === 'class' || c.kind === 'struct') visit(c);
        for (const c of order) out.push(classCode(c));
        const scripts = order.filter(c => scriptCls(c) && !c.abstract && !(c.d.tps && c.d.tps.length)).map(c => '[' + c.js + ', ' + JSON.stringify(c.name) + ', ' + JSON.stringify(msgMeta(c)) + ']');
        if (main === 'null') {
          const pm = order.find(c => { const m = c.mem.get('Main'); return m && m.kind === 'method' && m.static; });
          if (pm) { const o = pm.mem.get('Main').ovs[0]; main = '() => ' + pm.js + '.' + o.js + '(' + (o.params.length ? '[]' : '') + ')'; }
        }
        const exp = [...CL.values()].filter(c => c.kind === 'class' || c.kind === 'struct' || c.kind === 'enum').map(c => JSON.stringify(c.name) + ': ' + c.js);
        out.push(mark(lastLine) + 'return { main: ' + main + ', scripts: [' + scripts.join(', ') + '], classes: {' + exp.join(', ') + '} };');
        const used = [...USED].filter(n => !clsOf(n)).sort();
        return Object.assign(assemble(out.join(''), "'use strict'; " + (used.length ? 'const { ' + used.join(', ') + ' } = $.A; ' : '')), { types: CL });
      };
    }

    function assemble(code, pro){   // метки строк → переводы строк; карта: строка JS → [[столбец, строка C#], …]
      const lines = [pro], map = [[]];
      const re = new RegExp(MK + '(\\d+)' + MK2, 'g');
      let cur = 0, last = 0, m;
      while ((m = re.exec(code))) {
        lines[cur] += code.slice(last, m.index); last = re.lastIndex;
        const L = +m[1];
        if (L - 1 > cur) { while (cur < L - 1) { cur++; lines.push(''); map.push([]); } map[cur].push([0, L]); }
        else map[cur].push([lines[cur].length, L]);
      }
      lines[cur] += code.slice(last);
      return { js: lines.join('\n'), map };
    }
    function compile(src, xc){   // xc — типы других скриптов этого запуска (имя → описание класса)
      const T = lex(String(src));
      const U = parse(T).unit();
      return gen(U, xc)(T[T.length - 1].line);
    }

    // ═══ 4. Библиотека C# внутри песочницы: $ (помощники) и $.A (List, Mathf, Vector3, Debug …) ═══
    // ── числа в строки как в C# (культура — инвариантная: точка, тысячи через запятую) ──
    const fixedS = (v, d) => { let s = Math.abs(v).toFixed(Math.min(100, Math.max(0, d))); if (v < 0 && /[1-9]/.test(s)) s = '-' + s; return s; };
    const groupS = s => { const m = /^(-?)(\d+)(.*)$/.exec(s); return m ? m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + m[3] : s; };
    function gS(v, p){   // «общий» формат: целые — как есть, дробные — p значащих цифр (float — 7, double — 15)
      if (!isFinite(v)) return isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
      if (Number.isInteger(v) && Math.abs(v) < 1e15) return Object.is(v, -0) ? '0' : String(v);
      return String(+v.toPrecision(p)).replace(/e([+-])(\d+)$/, (q, sg, d) => 'E' + sg + d.padStart(2, '0'));
    }
    function fmtNum(v, f){
      if (f == null || f === '') return gS(v, 15);
      const m = /^([A-Za-z])(\d{0,2})$/.exec(f);
      if (m) {
        const c = m[1].toUpperCase(), d = m[2] === '' ? -1 : +m[2];
        switch (c) {
          case 'F': return fixedS(v, d < 0 ? 2 : d);
          case 'N': return groupS(fixedS(v, d < 0 ? 2 : d));
          case 'C': return groupS(fixedS(v, d < 0 ? 2 : d));
          case 'D': { const s = String(Math.abs(Math.trunc(v))); return (v < 0 ? '-' : '') + (d > 0 ? s.padStart(d, '0') : s); }
          case 'P': return groupS(fixedS(v * 100, d < 0 ? 2 : d)) + ' %';
          case 'X': { let s = (Math.trunc(v) >>> 0).toString(16); if (m[1] === 'X') s = s.toUpperCase(); return d > 0 ? s.padStart(d, '0') : s; }
          case 'E': { const s = v.toExponential(d < 0 ? 6 : d).replace(/e([+-])(\d+)$/, (q, sg, x) => 'E' + sg + x.padStart(3, '0')); return m[1] === 'e' ? s.replace('E', 'e') : s; }
          case 'G': return d > 0 ? gS(+v.toPrecision(d), 15) : gS(v, 15);
          case 'R': return gS(v, 17);
        }
      }
      return customNum(v, f);
    }
    function customNum(v, f){   // "0.00", "#.##", "0", "000", "#,##0", "0%", "Счёт: 0"
      const secs = f.split(';');
      if (secs.length > 1) { if (v < 0 && secs[1]) { f = secs[1]; v = -v; } else if (v === 0 && secs[2]) f = secs[2]; else f = secs[0]; }
      const lit = x => x.replace(/'([^']*)'|"([^"]*)"|\\(.)/g, (q, a, b, c) => a !== undefined ? a : b !== undefined ? b : c);
      if (/%/.test(f.replace(/'[^']*'/g, ''))) v *= 100;
      const m = /^([^0#]*?)([0#,]*)(?:\.([0#]*))?([^0#]*)$/.exec(f);
      if (!m || (!m[2] && m[3] === undefined)) return lit(f);
      const ip = m[2], fp = m[3] || '', minF = (fp.match(/0/g) || []).length;
      let [i, fr = ''] = Math.abs(v).toFixed(fp.length).split('.');
      while (fr.length > minF && fr.endsWith('0')) fr = fr.slice(0, -1);
      const minI = (ip.match(/0/g) || []).length;
      if (minI === 0 && i === '0') i = '';
      i = i.padStart(minI, '0');
      if (ip.includes(',')) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      let r = i + (fr ? '.' + fr : '');
      if (v < 0 && /[1-9]/.test(r)) r = '-' + r;
      return lit(m[1]) + r + lit(m[4]);
    }
    const bround = x => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };   // к чётному, как Math.Round в C#
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v, clamp01 = v => clamp(v, 0, 1);

    let RT = null;   // общее для всех C#-скриптов песочницы (одна среда env)
    function boot(env, ctx0){
      if (RT && RT.V3B === env.Vector3) return RT;
      const V3B = env.Vector3;
      const isV = v => v instanceof V3B;
      // ── исключения C# ──
      class Exception extends Error {
        constructor(message, inner){ super(message == null ? 'Ошибка ' + new.target.name : String(message)); this.InnerException = inner || null; }
        get Message(){ return this.message; }
        get StackTrace(){ return ''; }
        get $type(){ return this.constructor.name; }
        ToString(){ return this.$type + ': ' + this.message; }
      }
      const EX = { Exception };
      const mkExc = (name, base) => { EX[name] = ({ [name]: class extends base {} })[name]; return EX[name]; };
      const SysEx = mkExc('SystemException', Exception), ArgEx = mkExc('ArgumentException', SysEx);
      mkExc('ArgumentNullException', ArgEx); mkExc('ArgumentOutOfRangeException', ArgEx);
      for (const n of ['InvalidOperationException', 'NullReferenceException', 'IndexOutOfRangeException', 'KeyNotFoundException', 'DivideByZeroException', 'FormatException',
        'NotImplementedException', 'NotSupportedException', 'OverflowException', 'InvalidCastException', 'TimeoutException', 'StackOverflowException', 'MissingMethodException']) mkExc(n, SysEx);
      const nre = what => new EX.NullReferenceException('обращение к «' + what + '» у пустого значения (null)');
      const idxErr = (i, n) => new EX.IndexOutOfRangeException('индекс ' + S(i) + ' вне границ (элементов: ' + n + ')');
      const aoor = (i, n) => new EX.ArgumentOutOfRangeException('индекс ' + S(i) + ' вне границ (элементов: ' + n + ')');
      const emptyErr = w => new EX.InvalidOperationException('последовательность пуста' + (w ? ' (' + w + ')' : ''));
      const tn = v => v == null ? 'null' : Array.isArray(v) ? 'список' : isV(v) ? 'Vector3' : typeof v === 'number' ? 'число' : typeof v === 'string' ? 'строка' : typeof v === 'boolean' ? 'bool' :
        typeof v === 'function' ? 'метод' : (v.constructor && v.constructor !== Object && v.constructor.name) || 'объект';
      // ── в строку как в C# ──
      function S(v){
        if (v == null) return '';
        switch (typeof v) {
          case 'string': return v;
          case 'number': return gS(v, 15);
          case 'boolean': return v ? 'True' : 'False';
          case 'function': return 'делегат';
          case 'object':
            if (Array.isArray(v)) return '[' + v.map(S).join(', ') + ']';
            if (isV(v)) return '(' + fixedS(v.X, 2) + ', ' + fixedS(v.Y, 2) + ', ' + fixedS(v.Z, 2) + ')';
            if (typeof v.ToString === 'function') return String(v.ToString());
            if (v instanceof Error) return String(v.message);
            if (v.toString !== Object.prototype.toString) return String(v);
            if (Object.getPrototypeOf(v) === Object.prototype) return '{ ' + Object.keys(v).map(k => k + ' = ' + S(v[k])).join(', ') + ' }';
        }
        return String(v);
      }
      const fmtAny = (v, f) => typeof v === 'number' ? fmtNum(v, f) : isV(v) ? '(' + [v.X, v.Y, v.Z].map(x => fmtNum(x, f)).join(', ') + ')' : v != null && typeof v.ToString === 'function' ? String(v.ToString(f)) : S(v);
      const cmp0 = (a, b) => {
        if (a === b) return 0;
        if (a == null) return -1; if (b == null) return 1;
        if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
        if (typeof a === 'string' && typeof b === 'string') { const c = a.localeCompare(b); return c < 0 ? -1 : c > 0 ? 1 : 0; }
        if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
        if (typeof a.CompareTo === 'function') return a.CompareTo(b);
        throw new EX.InvalidOperationException('не умею сравнивать ' + tn(a) + ' и ' + tn(b));
      };
      const opf = (name, a, b) => (a != null && a.constructor && a.constructor[name]) || (b != null && b.constructor && b.constructor[name]) || null;
      const dflt = a => a.length && typeof a[0] === 'number' ? 0 : a.length && typeof a[0] === 'boolean' ? false : null;
      const ic = c => c === 1 || c === 3 || c === 5 || c === true;   // StringComparison.*IgnoreCase
      // ── Vector3 (класс песочницы + то, что есть в Unity) ──
      class V3 extends V3B {
        static get zero(){ return new V3(0, 0, 0); } static get one(){ return new V3(1, 1, 1); }
        static get up(){ return new V3(0, 1, 0); } static get down(){ return new V3(0, -1, 0); }
        static get forward(){ return new V3(0, 0, 1); } static get back(){ return new V3(0, 0, -1); }
        static get left(){ return new V3(-1, 0, 0); } static get right(){ return new V3(1, 0, 0); }
        static get positiveInfinity(){ return new V3(Infinity, Infinity, Infinity); } static get negativeInfinity(){ return new V3(-Infinity, -Infinity, -Infinity); }
        static new(x, y, z){ return new V3(x, y, z); }
        static Distance(a, b){ return Math.hypot(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
        static Dot(a, b){ return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
        static Cross(a, b){ return new V3(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X); }
        static LerpUnclamped(a, b, t){ return new V3(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t); }
        static Lerp(a, b, t){ return V3.LerpUnclamped(a, b, clamp01(t)); }
        static Slerp(a, b, t){ return V3.Lerp(a, b, t); }
        static Normalize(v){ return v.normalized; }
        static Magnitude(v){ return v.Magnitude; } static SqrMagnitude(v){ return v.sqrMagnitude; }
        static MoveTowards(a, b, d){ const dx = b.X - a.X, dy = b.Y - a.Y, dz = b.Z - a.Z, l = Math.hypot(dx, dy, dz); if (l <= d || l === 0) return new V3(b.X, b.Y, b.Z); return new V3(a.X + dx / l * d, a.Y + dy / l * d, a.Z + dz / l * d); }
        static Scale(a, b){ return new V3(a.X * b.X, a.Y * b.Y, a.Z * b.Z); }
        static ClampMagnitude(v, m){ const l = v.Magnitude; return l > m && l > 0 ? new V3(v.X / l * m, v.Y / l * m, v.Z / l * m) : new V3(v.X, v.Y, v.Z); }
        static Max(a, b){ return new V3(Math.max(a.X, b.X), Math.max(a.Y, b.Y), Math.max(a.Z, b.Z)); }
        static Min(a, b){ return new V3(Math.min(a.X, b.X), Math.min(a.Y, b.Y), Math.min(a.Z, b.Z)); }
        static Angle(a, b){ const d = Math.sqrt(a.sqrMagnitude * b.sqrMagnitude); return d < 1e-15 ? 0 : Math.acos(clamp(V3.Dot(a, b) / d, -1, 1)) * 180 / Math.PI; }
        static SignedAngle(a, b, ax){ const g = V3.Angle(a, b), c = V3.Cross(a, b); return V3.Dot(ax, c) < 0 ? -g : g; }
        static Project(v, n){ const d = V3.Dot(n, n); if (d < 1e-15) return V3.zero; const k = V3.Dot(v, n) / d; return new V3(n.X * k, n.Y * k, n.Z * k); }
        static ProjectOnPlane(v, n){ const p = V3.Project(v, n); return new V3(v.X - p.X, v.Y - p.Y, v.Z - p.Z); }
        static Reflect(v, n){ const k = -2 * V3.Dot(n, v); return new V3(n.X * k + v.X, n.Y * k + v.Y, n.Z * k + v.Z); }
      }
      const rotv = (r, x, y, z) => {   // поворот вектора на Orientation (градусы, порядок YXZ, как у деталей)
        const D = Math.PI / 180, [ax, ay, az] = [r.X * D, r.Y * D, r.Z * D];
        let c = Math.cos(az), s = Math.sin(az); [x, y] = [x * c - y * s, x * s + y * c];
        c = Math.cos(ax); s = Math.sin(ax); [y, z] = [y * c - z * s, y * s + z * c];
        c = Math.cos(ay); s = Math.sin(ay); [x, z] = [x * c + z * s, -x * s + z * c];
        return new V3(x, y, z);
      };
      // ── цвет: строки "#rrggbb", как у деталей ──
      const hx = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
      const rgbHex = (r, g, b) => '#' + hx(r * 255) + hx(g * 255) + hx(b * 255);
      const hexRgb = h => { const s = /^#?([0-9a-f]{6})$/i.exec(String(h)); if (!s) return [1, 1, 1]; const n = parseInt(s[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
      const colorSet = (h, k, v) => { const c = hexRgb(h), i = 'rgb'.indexOf(k); if (i < 0) return h; c[i] = v; return rgbHex(c[0], c[1], c[2]); };

      // ── $ — помощники переведённого кода ──
      const CONN = new WeakMap(), MG = new WeakMap(), TFC = new WeakMap(), GOC = new WeakMap(), HS = new WeakMap(), WAS = new WeakMap(), INACTIVE = new WeakSet();
      let hseq = 0;
      const H = {
        s: S, sf: v => typeof v === 'number' ? gS(v, 7) : S(v), fmt: fmtAny,
        al(s, n){ n = n | 0; s = S(s); return n < 0 ? s.padEnd(-n) : s.padStart(n); },
        str(v, f){ if (v == null) throw nre('ToString'); if (typeof v === 'number' && typeof f === 'number') return (v >>> 0).toString(f); return f === undefined ? S(v) : fmtAny(v, f); },
        srep: (c, n) => S(c).repeat(Math.max(0, n | 0)),
        en(E, v){
          if (E) {
            for (const k of Object.keys(E)) if (E[k] === v) return k;
            if (typeof v === 'number' && v > 0) { const parts = []; let rest = v; for (const k of Object.keys(E).sort((a, b) => E[b] - E[a])) { const x = E[k]; if (x > 0 && (rest & x) === x) { parts.unshift(k); rest &= ~x; } } if (!rest && parts.length) return parts.join(', '); }
          }
          return S(v);
        },
        enm(name, fill){ const o = {}; fill(o); Object.defineProperty(o, '$name', { value: name }); return Object.freeze(o); },
        i: v => typeof v === 'number' ? Math.trunc(v) || 0 : v == null ? 0 : v,
        trunc(v){ if (typeof v !== 'number') { if (v == null) throw nre('(int)'); v = Number(v); } return Math.trunc(v) || 0; },
        num(v){ if (typeof v === 'number') return v; if (v == null) throw nre('(float)'); const n = Number(v); if (isNaN(n)) throw new EX.InvalidCastException('«' + S(v) + '» — не число'); return n; },
        ord: c => typeof c === 'string' ? c.charCodeAt(0) || 0 : +c || 0,
        chr: n => String.fromCharCode(Math.trunc(n) & 0xFFFF),
        idiv(a, b){ if (b === 0) throw new EX.DivideByZeroException('деление на ноль'); return Math.trunc(a / b) || 0; },
        imod(a, b){ if (b === 0) throw new EX.DivideByZeroException('деление на ноль'); return a % b; },
        add(a, b){
          const ta = typeof a, tb = typeof b;
          if (ta === 'number' && tb === 'number') return a + b;
          if (ta === 'string' || tb === 'string') return S(a) + S(b);
          if (isV(a) && isV(b)) return new V3(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
          const f = opf('op_Addition', a, b); if (f) return f(a, b);
          if (ta === 'function' || tb === 'function') return H.dadd(a, b);
          if (a == null || b == null) throw nre('+');
          throw new TypeError('Нельзя сложить: ' + tn(a) + ' + ' + tn(b));
        },
        sub(a, b){
          if (typeof a === 'number' && typeof b === 'number') return a - b;
          if (isV(a) && isV(b)) return new V3(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
          const f = opf('op_Subtraction', a, b); if (f) return f(a, b);
          if (typeof a === 'function') return H.dsub(a, b);
          if (a == null || b == null) throw nre('-');
          throw new TypeError('Нельзя вычесть: ' + tn(a) + ' - ' + tn(b));
        },
        mul(a, b){
          const ta = typeof a, tb = typeof b;
          if (ta === 'number' && tb === 'number') return a * b;
          if (isV(a) && tb === 'number') return new V3(a.X * b, a.Y * b, a.Z * b);
          if (ta === 'number' && isV(b)) return new V3(b.X * a, b.Y * a, b.Z * a);
          if (isV(a) && isV(b)) return new V3(a.X * b.X, a.Y * b.Y, a.Z * b.Z);
          const f = opf('op_Multiply', a, b); if (f) return f(a, b);
          if (a == null || b == null) throw nre('*');
          throw new TypeError('Нельзя умножить: ' + tn(a) + ' * ' + tn(b));
        },
        div(a, b){
          if (typeof a === 'number' && typeof b === 'number') return a / b;
          if (isV(a) && typeof b === 'number') return new V3(a.X / b, a.Y / b, a.Z / b);
          if (isV(a) && isV(b)) return new V3(a.X / b.X, a.Y / b.Y, a.Z / b.Z);
          const f = opf('op_Division', a, b); if (f) return f(a, b);
          if (a == null || b == null) throw nre('/');
          throw new TypeError('Нельзя разделить: ' + tn(a) + ' / ' + tn(b));
        },
        neg(a){
          if (typeof a === 'number') return -a;
          if (isV(a)) return new V3(-a.X, -a.Y, -a.Z);
          const f = opf('op_UnaryNegation', a, null); if (f) return f(a);
          if (a == null) throw nre('-');
          throw new TypeError('Нельзя взять минус у ' + tn(a));
        },
        eq(a, b){
          if (a === b) return true;
          if (a == null || b == null) return a == null && b == null;
          if (typeof a === 'object' && typeof b === 'object') {
            if (isV(a) && isV(b)) { const dx = a.X - b.X, dy = a.Y - b.Y, dz = a.Z - b.Z; return dx * dx + dy * dy + dz * dz < 1e-10; }
            const f = opf('op_Equality', a, b); if (f) return !!f(a, b);
            if (a instanceof KVP && b instanceof KVP) return H.eq(a.Key, b.Key) && H.eq(a.Value, b.Value);
            if ((a.$go && b.$go) || (a.$tf && b.$tf)) return a.$p === b.$p;
          }
          return false;
        },
        equals(a, b){ if (a == null) throw nre('Equals'); if (typeof a === 'object' && !isV(a) && typeof a.Equals === 'function') return !!a.Equals(b); return H.eq(a, b); },
        cmp: (a, b) => { if (a == null) throw nre('CompareTo'); return cmp0(a, b); },
        hash(v){
          if (v == null) throw nre('GetHashCode');
          if (typeof v === 'number') return Number.isInteger(v) ? v | 0 : (v * 1e6) | 0;
          if (typeof v === 'string') { let h = 0; for (let i = 0; i < v.length; i++) h = (Math.imul(h, 31) + v.charCodeAt(i)) | 0; return h; }
          if (typeof v === 'boolean') return v ? 1 : 0;
          if (typeof v.GetHashCode === 'function') return v.GetHashCode();
          let h = HS.get(v); if (h === undefined) HS.set(v, h = ++hseq); return h;
        },
        typeOf: n => ({ Name: n, FullName: n, ToString(){ return n; }, toString(){ return n; } }),
        type(v){
          if (v == null) throw nre('GetType');
          return H.typeOf(typeof v === 'number' ? (Number.isInteger(v) ? 'Int32' : 'Single') : typeof v === 'string' ? 'String' : typeof v === 'boolean' ? 'Boolean' : Array.isArray(v) ? 'List`1' :
            isV(v) ? 'Vector3' : typeof v.ClassName === 'string' ? v.ClassName : (v.constructor && v.constructor.name) || 'Object');
        },
        // индексы
        ix(o, i){
          if (Array.isArray(o) || typeof o === 'string') { if (Number.isInteger(i) && i >= 0 && i < o.length) return o[i]; throw idxErr(i, o.length); }
          if (o == null) throw nre('[ ]');
          if (o instanceof Map) { if (o.has(i)) return o.get(i); throw new EX.KeyNotFoundException('ключа «' + S(i) + '» нет в словаре'); }
          if (typeof o.$get === 'function') return o.$get(i);
          return o[i];
        },
        sx(o, i, v){
          if (Array.isArray(o)) { if (Number.isInteger(i) && i >= 0 && i < o.length) return (o[i] = v); throw idxErr(i, o.length); }
          if (o == null) throw nre('[ ]');
          if (o instanceof Map) { o.set(i, v); return v; }
          if (typeof o.$set === 'function') { o.$set(i, v); return v; }
          if (typeof o === 'string') throw new TypeError('строку нельзя менять по символам');
          o[i] = v; return v;
        },
        len(o){ if (o == null) throw nre('Length'); return typeof o === 'string' || Array.isArray(o) ? o.length : o.Count; },
        ixh(o, n){ return H.ix(o, H.len(o) - n); },
        sxh(o, n, v){ return H.sx(o, H.len(o) - n, v); },
        rng(o, a, af, b, bf){
          const n = H.len(o), s = a == null ? 0 : af ? n - a : a, e = b == null ? n : bf ? n - b : b;
          if (s < 0 || e > n || s > e) throw new EX.ArgumentOutOfRangeException('диапазон ' + s + '..' + e + ' вне 0..' + n);
          return o.slice(s, e);
        },
        dget(d, k){ if (d == null) throw nre('[ ]'); if (!(d instanceof Map)) return H.ix(d, k); if (!d.has(k)) throw new EX.KeyNotFoundException('ключа «' + S(k) + '» нет в словаре'); return d.get(k); },
        dset(d, k, v){ if (d == null) throw nre('[ ]'); if (!(d instanceof Map)) return H.sx(d, k, v); d.set(k, v); return v; },
        len2: a => a.length && a[0] ? a.length * a[0].length : 0,
        it(x){
          if (x == null) throw nre('foreach');
          if (typeof x === 'string' || typeof x[Symbol.iterator] === 'function') return x;
          if (typeof x.next === 'function') return { [Symbol.iterator]: () => x };
          if (typeof x.GetChildren === 'function') return x.GetChildren();
          throw new TypeError('foreach: «' + tn(x) + '» нельзя перебрать');
        },
        dc(v){   // var (a, b) = …
          if (v == null) throw nre('(a, b) = …');
          if (Array.isArray(v)) return v;
          if (v instanceof KVP) return [v.Key, v.Value];
          if (isV(v)) return [v.X, v.Y, v.Z];
          if ('Item1' in v) return [v.Item1, v.Item2, v.Item3, v.Item4];
          if (typeof v.Deconstruct === 'function') { const b = [H.box(), H.box(), H.box(), H.box()]; v.Deconstruct(...b); return b.map(x => x.v); }
          throw new TypeError('Это нельзя разложить на (a, b)');
        },
        nn: (v, f) => v == null ? null : f(v),
        inv(f, ...a){
          if (f == null) throw nre('вызов (у делегата нет методов)');
          if (typeof f === 'function') return f(...a);
          if (typeof f.Invoke === 'function') return f.Invoke(...a);
          throw new TypeError('Это не метод');
        },
        dadd(a, b){
          if (a == null) return b; if (b == null) return a;
          const list = (a.$list || [a]).concat(b.$list || [b]);
          const f = function (...x) { let r; for (const g of list) r = g.apply(this, x); return r; };
          f.$list = list; return f;
        },
        dsub(a, b){
          if (a == null || b == null) return a;
          const list = (a.$list || [a]).slice(), rm = b.$list || [b];
          for (let i = list.length - rm.length; i >= 0; i--) if (rm.every((g, j) => list[i + j] === g)) { list.splice(i, rm.length); break; }
          if (!list.length) return null;
          if (list.length === 1) return list[0];
          const f = function (...x) { let r; for (const g of list) r = g.apply(this, x); return r; };
          f.$list = list; return f;
        },
        mg(o, n){   // метод как значение — одна и та же функция (чтобы работало -=)
          if (o == null) throw nre(n);
          let m = MG.get(o); if (!m) MG.set(o, m = new Map());
          let f = m.get(n);
          if (!f) { const fn = o[n]; if (typeof fn !== 'function') throw new TypeError('«' + n + '» — не метод'); f = fn.bind(o); m.set(n, f); }
          return f;
        },
        ini(o, f){ f(o); return o; },
        arr(n, d){ n = H.trunc(n); if (n < 0) throw new EX.OverflowException('размер массива меньше нуля'); if (n > 1e7) throw new EX.OverflowException('слишком большой массив'); return new Array(n).fill(d); },
        arrf: (n, f) => Array.from({ length: H.trunc(n) }, f),
        arr2: (a, b, d) => Array.from({ length: H.trunc(a) }, () => new Array(H.trunc(b)).fill(d)),
        nl(x){ if (typeof x === 'number') return []; if (x == null) throw new EX.ArgumentNullException('new List(null)'); return Array.from(H.it(x)); },
        dinit(d, items){ for (const [k, v] of items) d.Add(k, v); return d; },
        kv: (k, v) => new KVP(k, v),
        is(x, T){
          if (x == null) return false;
          if (typeof T === 'function') return T === Dictionary ? x instanceof Map : x instanceof T || (!!T.$exc && x.$type === T.name);
          switch (T) {
            case 'object': return true;
            case 'int': return typeof x === 'number' && Number.isInteger(x);
            case 'float': case 'double': case 'decimal': return typeof x === 'number';
            case 'string': return typeof x === 'string';
            case 'char': return typeof x === 'string' && x.length === 1;
            case 'bool': return typeof x === 'boolean';
            case 'List': return Array.isArray(x);
            case 'Vector3': return isV(x);
            case 'Color': return typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);
            case 'Player': return typeof x === 'object' && 'UserId' in x && 'Humanoid' in x;
            case 'Part': case 'BasePart': return typeof x.IsA === 'function' && x.IsA('BasePart');
            case 'Model': case 'Folder': return typeof x.IsA === 'function' && x.IsA('Model');
            case 'Transform': return !!x.$tf;
            case 'GameObject': return !!x.$go;
            case 'Collider': case 'Collision': return typeof x === 'object';
            case 'Action': case 'Func': case 'Delegate': case 'Predicate': return typeof x === 'function';
          }
          if (typeof x === 'object' && typeof x.IsA === 'function') { try { if (x.IsA(T)) return true; } catch (e) {} }
          for (let c = x.constructor; c && c !== Object; c = Object.getPrototypeOf(c)) if (c.$ifc && c.$ifc.includes(T)) return true;
          return false;
        },
        as: (x, T) => H.is(x, T) ? x : null,
        cast(x, T){ if (x == null || x instanceof T) return x; throw new EX.InvalidCastException('нельзя привести ' + tn(x) + ' к ' + T.name); },
        exc(e){
          if (e == null || typeof e !== 'object' || e instanceof Exception || '$type' in e) return e;
          const m = String(e.message || ''), t = e instanceof TypeError ? (/null|undefined/.test(m) ? 'NullReferenceException' : /not a function/.test(m) ? 'MissingMethodException' : 'InvalidOperationException') :
            e instanceof RangeError ? (/stack/i.test(m) ? 'StackOverflowException' : 'ArgumentOutOfRangeException') : 'Exception';
          try {
            Object.defineProperty(e, '$type', { value: t, configurable: true });
            Object.defineProperty(e, 'Message', { get(){ return csMsg(this, true); }, configurable: true });
            Object.defineProperty(e, 'StackTrace', { value: '', configurable: true });
          } catch (x) {}
          return e;
        },
        isExc(e, T){ if (e == null) return false; if (typeof T !== 'function') return false; if (e instanceof T) return true; H.exc(e); for (let c = EX[e.$type]; c && c !== Error; c = Object.getPrototypeOf(c)) if (c === T) return true; return false; },
        thr(e){ throw e; },
        swf(v){ throw new EX.InvalidOperationException('switch: нет подходящей ветки для «' + S(v) + '»'); },
        rf: (g, s) => ({ get v(){ return g(); }, set v(x){ s(x); } }),
        box: () => ({ v: null }),
        disp(x){ if (x != null && typeof x.Dispose === 'function') x.Dispose(); },
        cl(x){ if (x == null || typeof x !== 'object') return x; return Object.assign(Object.create(Object.getPrototypeOf(x)), x); },
        setm(o, k, v){   // v.x = 5 → новый Vector3 (Vector3 и Color неизменяемые, как struct в C#)
          if (o == null) throw nre(k);
          if (isV(o)) { const K = k.toUpperCase(); return new V3(K === 'X' ? v : o.X, K === 'Y' ? v : o.Y, K === 'Z' ? v : o.Z); }
          if (typeof o === 'string') return colorSet(o, k, v);
          o[k] = v; return o;
        },
        vnorm(v){ if (isV(v)) return v.normalized; if (v != null && typeof v.Normalize === 'function') v.Normalize(); return v; },
        vset(v, x, y, z){ if (v == null || isV(v)) return new V3(x, y, z); v.Set(x, y, z); return v; },
        ovk(a, sigs, name){   // выбор перегрузки во время работы: по числу и типам аргументов
          const ok = (v, t, strict) => {
            if (t === '*') return true;
            if (typeof t === 'function') return v == null || v instanceof t;
            if (v == null) return t === 'string';
            switch (t) {
              case 'int': return typeof v === 'number' && (!strict || Number.isInteger(v));
              case 'float': case 'double': case 'decimal': return typeof v === 'number';
              case 'string': return typeof v === 'string';
              case 'char': return typeof v === 'string' && v.length === 1;
              case 'bool': return typeof v === 'boolean';
              case 'Vector3': return isV(v);
            }
            return true;
          };
          for (const strict of [true, false]) for (let i = 0; i < sigs.length; i++) { const [mn, mx, ts] = sigs[i]; if (a.length >= mn && a.length <= mx && a.every((v, j) => j >= ts.length || ok(v, ts[j], strict))) return i; }
          throw new EX.ArgumentException('нет подходящего варианта ' + name + '(' + a.map(tn).join(', ') + ')');
        },
        // Unity: transform / gameObject / tag / name у деталей мира
        tf(p){
          if (p == null) throw nre('transform');
          if (p.$tf) return p;
          if (p.$go) p = p.$p;
          let t = TFC.get(p); if (t) return t;
          t = {
            $tf: true, $p: p,
            get position(){ return p.Position; }, set position(v){ p.Position = v; },
            get localPosition(){ return p.Position; }, set localPosition(v){ p.Position = v; },
            get localScale(){ return p.Size; }, set localScale(v){ p.Size = v; },
            get lossyScale(){ return p.Size; },
            get eulerAngles(){ return p.Orientation; }, set eulerAngles(v){ p.Orientation = v; },
            get localEulerAngles(){ return p.Orientation; }, set localEulerAngles(v){ p.Orientation = v; },
            get rotation(){ return p.Orientation; }, set rotation(v){ p.Orientation = v; },
            get forward(){ return rotv(p.Orientation || V3.zero, 0, 0, 1); }, get right(){ return rotv(p.Orientation || V3.zero, 1, 0, 0); }, get up(){ return rotv(p.Orientation || V3.zero, 0, 1, 0); },
            get name(){ return H.nm(p); }, set name(v){ H.setnm(p, v); },
            get gameObject(){ return H.go(p); }, get transform(){ return t; },
            get parent(){ const q = p.Parent; return q && q.ClassName !== 'Workspace' && q.Name !== 'Workspace' ? H.tf(q) : null; },
            get childCount(){ return p.GetChildren ? p.GetChildren().length : 0; },
            GetChild(i){ return H.tf(H.ix(p.GetChildren(), i)); },
            Find(n){ const c = p.FindFirstChild(n); return c ? H.tf(c) : null; },
            SetParent(q){ p.Parent = q && (q.$tf || q.$go) ? q.$p : q; },
            Translate(x, y, z, sp){ let v = x; if (!isV(x)) v = new V3(x, y, z); else sp = y; const w = sp === 1 ? v : rotv(p.Orientation || V3.zero, v.X, v.Y, v.Z); p.Position = H.add(p.Position, w); },
            Rotate(x, y, z){ const v = isV(x) ? x : new V3(x, y, z), r = p.Orientation; p.Orientation = new V3(((r.X + v.X) % 360 + 360) % 360, ((r.Y + v.Y) % 360 + 360) % 360, ((r.Z + v.Z) % 360 + 360) % 360); },
            LookAt(o){ const tp = isV(o) ? o : (o.$tf || o.$go) ? o.$p.Position : o.Position, a = p.Position, dx = tp.X - a.X, dy = tp.Y - a.Y, dz = tp.Z - a.Z; p.Orientation = new V3(-Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI, Math.atan2(dx, dz) * 180 / Math.PI, 0); },
            ToString(){ return S(H.nm(p)); },
          };
          TFC.set(p, t); return t;
        },
        go(p){
          if (p == null) throw nre('gameObject');
          if (p.$go) return p;
          if (p.$tf) p = p.$p;
          let g = GOC.get(p); if (g) return g;
          g = {
            $go: true, $p: p,
            get name(){ return H.nm(p); }, set name(v){ H.setnm(p, v); },
            get transform(){ return H.tf(p); }, get gameObject(){ return g; },
            get tag(){ return H.tag(p); }, set tag(v){ H.settag(p, v); },
            get activeSelf(){ return !INACTIVE.has(p); }, get activeInHierarchy(){ return !INACTIVE.has(p); },
            SetActive(on){   // как в Unity: невидима и не мешает (и скрипты в ней молчат)
              on = !!on; if (on === !INACTIVE.has(p)) return;
              if (!on) { INACTIVE.add(p); WAS.set(p, { a: p.Transparency, c: p.CanCollide }); try { p.Transparency = 1; p.CanCollide = false; } catch (e) {} }
              else { INACTIVE.delete(p); const w = WAS.get(p) || { a: 0, c: true }; try { p.Transparency = w.a; p.CanCollide = w.c; } catch (e) {} }
            },
            CompareTag(t){ return H.ctag(p, t); },
            GetComponent(T){ return getComp(p, T, false); }, GetComponents(T){ return getComp(p, T, true); },
            ToString(){ return S(H.nm(p)); },
          };
          GOC.set(p, g); return g;
        },
        tag(x){
          if (x == null) throw nre('tag');
          if (x.$go || x.$tf) x = x.$p;
          if (x.__player || (x.Parent && x.Parent.__player)) return 'Player';
          if (typeof x.GetAttribute === 'function') return S(x.GetAttribute('tag') || 'Untagged');
          return S(x.tag || 'Untagged');
        },
        settag(x, v){ if (x.$go || x.$tf) x = x.$p; if (typeof x.SetAttribute === 'function') x.SetAttribute('tag', v); else x.tag = v; return v; },
        ctag: (x, t) => H.tag(x) === t,
        nm(x){ if (x == null) throw nre('name'); if (x.$go || x.$tf) return x.name; return x.Name !== undefined ? x.Name : x.name; },
        setnm(x, v){ if (x == null) throw nre('name'); if (x.$go || x.$tf) x = x.$p; if ('Name' in x) x.Name = v; else x.name = v; return v; },
        gc: (x, T, many) => getComp(x, T, many),
        X(n){ const c = XR.get(n); if (!c) throw new EX.InvalidOperationException('класс «' + n + '» из другого скрипта не загрузился'); return c; },
        // для каждого скрипта — свои (через this = $ этого скрипта)
        rep(e){ report(this, e); },
        guard(fn){
          if (typeof fn !== 'function') throw new TypeError('нужен метод или лямбда');
          const rt = this;
          return function (...a) {
            if (rt.ctx.setCurrent) rt.ctx.setCurrent(rt.name);
            try {
              const r = fn.apply(this, a);
              if (r && typeof r.then === 'function') r.then(null, e => rt.rep(e));
              else if (r && typeof r.next === 'function' && typeof r.throw === 'function') coStart(r, null, rt);
              return r;
            } catch (e) { rt.rep(e); }
          };
        },
        conn(sig, fn){
          if (sig == null) throw nre('Connect');
          if (typeof sig.Connect !== 'function') throw new TypeError('это не событие — у него нет Connect');
          const c = sig.Connect(this.guard(fn));
          let m = CONN.get(sig); if (!m) CONN.set(sig, m = new Map());
          const l = m.get(fn) || []; l.push(c); m.set(fn, l);
          return c;
        },
        evAdd(o, n, f){
          if (o == null) throw nre(n);
          const cur = o[n];
          if (cur && typeof cur.Connect === 'function') return this.conn(cur, f);
          o[n] = H.dadd(cur, f);
        },
        evRem(o, n, f){
          if (o == null) throw nre(n);
          const cur = o[n];
          if (cur && typeof cur.Connect === 'function') { const l = CONN.get(cur) && CONN.get(cur).get(f); if (l && l.length) l.pop().Disconnect(); return; }
          o[n] = H.dsub(cur, f);
        },
        fire(p){ if (p && typeof p.then === 'function') p.then(null, e => this.rep(e)); return p; },
      };

      // ── коллекции ──
      class KVP { constructor(k, v){ this.Key = k; this.Value = v; } ToString(){ return '[' + S(this.Key) + ', ' + S(this.Value) + ']'; } Deconstruct(a, b){ a.v = this.Key; b.v = this.Value; } }
      class Dictionary extends Map {
        constructor(src){ super(); if (src != null && typeof src !== 'number') for (const kv of H.it(src)) { if (kv instanceof KVP) this.set(kv.Key, kv.Value); else if (Array.isArray(kv)) this.set(kv[0], kv[1]); } }
        get Count(){ return this.size; }
        get Keys(){ return [...Map.prototype.keys.call(this)]; }
        get Values(){ return [...Map.prototype.values.call(this)]; }
        Add(k, v){ if (k == null) throw new EX.ArgumentNullException('ключ словаря — null'); if (this.has(k)) throw new EX.ArgumentException('ключ «' + S(k) + '» уже есть в словаре'); this.set(k, v); }
        TryAdd(k, v){ if (this.has(k)) return false; this.set(k, v); return true; }
        Remove(k, box){ if (box) box.v = this.get(k); return this.delete(k); }
        ContainsKey(k){ return this.has(k); }
        ContainsValue(v){ for (const x of Map.prototype.values.call(this)) if (H.eq(x, v)) return true; return false; }
        TryGetValue(k, box){ if (this.has(k)) { box.v = this.get(k); return true; } box.v = null; return false; }
        GetValueOrDefault(k, d = null){ return this.has(k) ? this.get(k) : d; }
        Clear(){ this.clear(); }
        *[Symbol.iterator](){ for (const [k, v] of Map.prototype.entries.call(this)) yield new KVP(k, v); }
        ToString(){ return '{' + [...this].map(kv => S(kv.Key) + ': ' + S(kv.Value)).join(', ') + '}'; }
      }
      class HashSet extends Set {
        constructor(src){ super(); if (src != null && typeof src !== 'number') for (const x of H.it(src)) this.add(x); }
        get Count(){ return this.size; }
        Add(x){ if (this.has(x)) return false; this.add(x); return true; }
        Remove(x){ return this.delete(x); }
        Contains(x){ return this.has(x); }
        Clear(){ this.clear(); }
        UnionWith(xs){ for (const x of H.it(xs)) this.add(x); }
        IntersectWith(xs){ const o = new Set(H.it(xs)); for (const x of [...this]) if (!o.has(x)) this.delete(x); }
        ExceptWith(xs){ for (const x of H.it(xs)) this.delete(x); }
        IsSubsetOf(xs){ const o = new Set(H.it(xs)); return [...this].every(x => o.has(x)); }
        IsSupersetOf(xs){ return [...H.it(xs)].every(x => this.has(x)); }
        Overlaps(xs){ return [...H.it(xs)].some(x => this.has(x)); }
        SetEquals(xs){ const o = new Set(H.it(xs)); return o.size === this.size && [...this].every(x => o.has(x)); }
        ToString(){ return '{' + [...this].map(S).join(', ') + '}'; }
      }
      class Queue {
        constructor(src){ this.$a = src != null && typeof src !== 'number' ? [...H.it(src)] : []; }
        get Count(){ return this.$a.length; }
        Enqueue(x){ this.$a.push(x); }
        Dequeue(){ if (!this.$a.length) throw new EX.InvalidOperationException('очередь пуста (Dequeue)'); return this.$a.shift(); }
        Peek(){ if (!this.$a.length) throw new EX.InvalidOperationException('очередь пуста (Peek)'); return this.$a[0]; }
        TryDequeue(b){ if (!this.$a.length) { b.v = null; return false; } b.v = this.$a.shift(); return true; }
        TryPeek(b){ if (!this.$a.length) { b.v = null; return false; } b.v = this.$a[0]; return true; }
        Contains(x){ return this.$a.Contains(x); }
        Clear(){ this.$a.length = 0; }
        ToArray(){ return this.$a.slice(); }
        [Symbol.iterator](){ return this.$a.slice()[Symbol.iterator](); }
        ToString(){ return S(this.$a); }
      }
      class Stack {
        constructor(src){ this.$a = src != null && typeof src !== 'number' ? [...H.it(src)] : []; }
        get Count(){ return this.$a.length; }
        Push(x){ this.$a.push(x); }
        Pop(){ if (!this.$a.length) throw new EX.InvalidOperationException('стек пуст (Pop)'); return this.$a.pop(); }
        Peek(){ if (!this.$a.length) throw new EX.InvalidOperationException('стек пуст (Peek)'); return this.$a[this.$a.length - 1]; }
        TryPop(b){ if (!this.$a.length) { b.v = null; return false; } b.v = this.$a.pop(); return true; }
        TryPeek(b){ if (!this.$a.length) { b.v = null; return false; } b.v = this.$a[this.$a.length - 1]; return true; }
        Contains(x){ return this.$a.Contains(x); }
        Clear(){ this.$a.length = 0; }
        ToArray(){ return this.$a.slice().reverse(); }
        [Symbol.iterator](){ return this.$a.slice().reverse()[Symbol.iterator](); }
        ToString(){ return S(this.ToArray()); }
      }
      class StringBuilder {
        constructor(s){ this.$s = s == null || typeof s === 'number' ? '' : S(s); }
        Append(x){ this.$s += S(x); return this; }
        AppendLine(x){ this.$s += (x === undefined ? '' : S(x)) + '\n'; return this; }
        AppendFormat(f, ...a){ this.$s += Str.Format(f, ...a); return this; }
        Insert(i, x){ this.$s = this.$s.slice(0, i) + S(x) + this.$s.slice(i); return this; }
        Remove(i, n){ this.$s = this.$s.slice(0, i) + this.$s.slice(i + n); return this; }
        Replace(a, b){ this.$s = this.$s.split(S(a)).join(S(b)); return this; }
        Clear(){ this.$s = ''; return this; }
        get Length(){ return this.$s.length; } set Length(n){ this.$s = this.$s.slice(0, Math.max(0, n)); }
        ToString(){ return this.$s; }
      }

      // ── методы C# у массивов (List<T> = массив) и строк — только внутри песочницы ──
      const def = (P, n, f) => { if (!Object.prototype.hasOwnProperty.call(P, n)) Object.defineProperty(P, n, { value: f, writable: true, configurable: true }); };
      const defG = (P, n, g) => { if (!Object.prototype.hasOwnProperty.call(P, n)) Object.defineProperty(P, n, { get: g, configurable: true }); };
      const AP = Array.prototype, SP = String.prototype, VP = V3B.prototype;
      const ordered = (src, keys) => { const r = src.slice().sort((a, b) => { for (const [f, d] of keys) { const c = cmp0(f(a), f(b)); if (c) return c * d; } return 0; }); Object.defineProperty(r, '$ord', { value: { src, keys } }); return r; };
      const L = {   // List<T> и LINQ
        Add(x){ this.push(x); },
        AddRange(xs){ for (const x of [...H.it(xs)]) this.push(x); },
        Insert(i, x){ if (!(i >= 0 && i <= this.length)) throw aoor(i, this.length); this.splice(i, 0, x); },
        InsertRange(i, xs){ this.splice(i, 0, ...H.it(xs)); },
        Remove(x){ const i = this.IndexOf(x); if (i < 0) return false; this.splice(i, 1); return true; },
        RemoveAt(i){ if (!(i >= 0 && i < this.length)) throw aoor(i, this.length); this.splice(i, 1); },
        RemoveAll(f){ let n = 0; for (let i = this.length - 1; i >= 0; i--) if (f(this[i])) { this.splice(i, 1); n++; } return n; },
        RemoveRange(i, n){ if (i < 0 || n < 0 || i + n > this.length) throw aoor(i, this.length); this.splice(i, n); },
        Clear(){ this.length = 0; },
        Contains(x){ return this.IndexOf(x) >= 0; },
        IndexOf(x, s){ for (let i = s || 0; i < this.length; i++) if (H.eq(this[i], x)) return i; return -1; },
        LastIndexOf(x){ for (let i = this.length - 1; i >= 0; i--) if (H.eq(this[i], x)) return i; return -1; },
        Find(f){ for (const x of this) if (f(x)) return x; return dflt(this); },
        FindLast(f){ for (let i = this.length - 1; i >= 0; i--) if (f(this[i])) return this[i]; return dflt(this); },
        FindIndex(a, b){ const f = typeof a === 'function' ? a : b; for (let i = typeof a === 'function' ? 0 : a; i < this.length; i++) if (f(this[i])) return i; return -1; },
        FindLastIndex(f){ for (let i = this.length - 1; i >= 0; i--) if (f(this[i])) return i; return -1; },
        FindAll(f){ return this.filter(x => f(x)); },
        Exists(f){ return this.some(x => f(x)); },
        TrueForAll(f){ return this.every(x => f(x)); },
        ForEach(f){ for (const x of this.slice()) f(x); },
        ConvertAll(f){ return this.map(x => f(x)); },
        GetRange(i, n){ if (i < 0 || n < 0 || i + n > this.length) throw aoor(i, this.length); return this.slice(i, i + n); },
        Sort(c){ if (!c) this.sort(cmp0); else if (typeof c === 'function') this.sort((a, b) => c(a, b)); else if (typeof c.Compare === 'function') this.sort((a, b) => c.Compare(a, b)); return this; },
        Reverse(){ this.reverse(); return this; },
        ToArray(){ return this.slice(); }, ToList(){ return this.slice(); },
        CopyTo(a, i = 0){ for (let j = 0; j < this.length; j++) a[i + j] = this[j]; },
        GetLength(d){ return d === 0 ? this.length : this[0] ? this[0].length : 0; },
        Where(f){ return this.filter((x, i) => f(x, i)); },
        Select(f){ return this.map((x, i) => f(x, i)); },
        SelectMany(f){ const r = []; for (const x of this) for (const y of H.it(f(x))) r.push(y); return r; },
        Any(f){ return f ? this.some(x => f(x)) : this.length > 0; },
        All(f){ return this.every(x => f(x)); },
        $Count(f){ return f ? this.filter(x => f(x)).length : this.length; },
        Sum(f){ let s = 0; for (const x of this) s += f ? f(x) : x; return s; },
        Average(f){ if (!this.length) throw emptyErr('Average'); return this.Sum(f) / this.length; },
        Max(f){ if (!this.length) throw emptyErr('Max'); let m, first = true; for (const x of this) { const v = f ? f(x) : x; if (first || cmp0(v, m) > 0) { m = v; first = false; } } return m; },
        Min(f){ if (!this.length) throw emptyErr('Min'); let m, first = true; for (const x of this) { const v = f ? f(x) : x; if (first || cmp0(v, m) < 0) { m = v; first = false; } } return m; },
        MaxBy(f){ if (!this.length) throw emptyErr('MaxBy'); let b = this[0]; for (const x of this) if (cmp0(f(x), f(b)) > 0) b = x; return b; },
        MinBy(f){ if (!this.length) throw emptyErr('MinBy'); let b = this[0]; for (const x of this) if (cmp0(f(x), f(b)) < 0) b = x; return b; },
        First(f){ for (const x of this) if (!f || f(x)) return x; throw f ? new EX.InvalidOperationException('нет подходящего элемента (First)') : emptyErr('First'); },
        FirstOrDefault(f, d){ if (typeof f !== 'function') { d = f; f = null; } for (const x of this) if (!f || f(x)) return x; return d === undefined ? dflt(this) : d; },
        Last(f){ for (let i = this.length - 1; i >= 0; i--) if (!f || f(this[i])) return this[i]; throw f ? new EX.InvalidOperationException('нет подходящего элемента (Last)') : emptyErr('Last'); },
        LastOrDefault(f, d){ if (typeof f !== 'function') { d = f; f = null; } for (let i = this.length - 1; i >= 0; i--) if (!f || f(this[i])) return this[i]; return d === undefined ? dflt(this) : d; },
        Single(f){ const r = f ? this.filter(x => f(x)) : this; if (r.length !== 1) throw new EX.InvalidOperationException('элементов ' + r.length + ', а нужен ровно один (Single)'); return r[0]; },
        SingleOrDefault(f){ const r = f ? this.filter(x => f(x)) : this; if (r.length > 1) throw new EX.InvalidOperationException('элементов больше одного (SingleOrDefault)'); return r.length ? r[0] : dflt(this); },
        ElementAt(i){ return H.ix(this, i); },
        ElementAtOrDefault(i){ return i >= 0 && i < this.length ? this[i] : dflt(this); },
        OrderBy(f){ return ordered(this, [[f, 1]]); },
        OrderByDescending(f){ return ordered(this, [[f, -1]]); },
        ThenBy(f){ return this.$ord ? ordered(this.$ord.src, this.$ord.keys.concat([[f, 1]])) : ordered(this, [[f, 1]]); },
        ThenByDescending(f){ return this.$ord ? ordered(this.$ord.src, this.$ord.keys.concat([[f, -1]])) : ordered(this, [[f, -1]]); },
        Take(n){ return this.slice(0, Math.max(0, n)); }, Skip(n){ return this.slice(Math.max(0, n)); },
        TakeLast(n){ return n > 0 ? this.slice(-n) : []; }, SkipLast(n){ return n > 0 ? this.slice(0, -n) : this.slice(); },
        TakeWhile(f){ const r = []; for (const x of this) { if (!f(x)) break; r.push(x); } return r; },
        SkipWhile(f){ let i = 0; while (i < this.length && f(this[i])) i++; return this.slice(i); },
        Distinct(){ const r = []; for (const x of this) if (!r.Contains(x)) r.push(x); return r; },
        DistinctBy(f){ const r = [], k = []; for (const x of this) { const v = f(x); if (!k.Contains(v)) { k.push(v); r.push(x); } } return r; },
        Concat(xs){ return this.concat([...H.it(xs)]); },
        Union(xs){ return this.concat([...H.it(xs)]).Distinct(); },
        Intersect(xs){ const o = [...H.it(xs)]; return this.Distinct().filter(x => o.Contains(x)); },
        Except(xs){ const o = [...H.it(xs)]; return this.Distinct().filter(x => !o.Contains(x)); },
        Append(x){ return this.concat([x]); }, Prepend(x){ return [x].concat(this); },
        Aggregate(a, b){ if (typeof a === 'function') { if (!this.length) throw emptyErr('Aggregate'); let acc = this[0]; for (let i = 1; i < this.length; i++) acc = a(acc, this[i]); return acc; } let acc = a; for (const x of this) acc = b(acc, x); return acc; },
        SequenceEqual(o){ o = [...H.it(o)]; return this.length === o.length && this.every((x, i) => H.eq(x, o[i])); },
        ToDictionary(kf, vf){ const d = new Dictionary(); for (const x of this) d.Add(kf(x), vf ? vf(x) : x); return d; },
        ToHashSet(){ return new HashSet(this); },
        GroupBy(kf){ const m = new Map(); for (const x of this) { const k = kf(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return [...m].map(([k, xs]) => { Object.defineProperty(xs, 'Key', { value: k }); return xs; }); },
        Cast(){ return this.slice(); },
      };
      if (!AP.$csLib) {
        Object.defineProperty(AP, '$csLib', { value: true });
        for (const k of Object.keys(L)) def(AP, k, L[k]);
        defG(AP, 'Count', function(){ return this.length; }); defG(AP, 'Length', function(){ return this.length; }); defG(AP, 'LongLength', function(){ return this.length; });
        // строки
        defG(SP, 'Length', function(){ return this.length; });
        const sx = { ToUpper(){ return this.toUpperCase(); }, ToLower(){ return this.toLowerCase(); }, ToUpperInvariant(){ return this.toUpperCase(); }, ToLowerInvariant(){ return this.toLowerCase(); },
          Contains(s, c){ s = S(s); return ic(c) ? this.toLowerCase().includes(s.toLowerCase()) : this.includes(s); },
          StartsWith(s, c){ s = S(s); return ic(c) ? this.toLowerCase().startsWith(s.toLowerCase()) : this.startsWith(s); },
          EndsWith(s, c){ s = S(s); return ic(c) ? this.toLowerCase().endsWith(s.toLowerCase()) : this.endsWith(s); },
          Substring(i, n){ if (!(i >= 0 && i <= this.length) || (n !== undefined && !(n >= 0 && i + n <= this.length))) throw new EX.ArgumentOutOfRangeException('Substring(' + i + (n !== undefined ? ', ' + n : '') + ') — за пределами строки длиной ' + this.length); return n === undefined ? this.slice(i) : this.slice(i, i + n); },
          Replace(a, b){ a = S(a); if (!a) throw new EX.ArgumentException('Replace: пустая строка'); return this.split(a).join(b == null ? '' : S(b)); },
          Split(...a){
            let opt = 0;
            if (a.length && typeof a[a.length - 1] === 'number') opt = a.pop();
            let seps = [];
            for (const x of a) { if (x == null) continue; if (Array.isArray(x)) seps.push(...x.map(S)); else seps.push(S(x)); }
            seps = seps.filter(x => x !== '');
            let parts = seps.length ? String(this).split(new RegExp(seps.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch)).join('|'))) : String(this).split(/\s/);
            if (opt & 2) parts = parts.map(x => x.trim());
            if (opt & 1) parts = parts.filter(x => x !== '');
            return parts;
          },
          Trim(...c){ return trimS(this, c, 3); }, TrimStart(...c){ return trimS(this, c, 1); }, TrimEnd(...c){ return trimS(this, c, 2); },
          IndexOf(s, st, c){ if (typeof st !== 'number') { c = st; st = 0; } s = S(s); return ic(c) ? this.toLowerCase().indexOf(s.toLowerCase(), st) : this.indexOf(s, st); },
          LastIndexOf(s){ return this.lastIndexOf(S(s)); },
          IndexOfAny(cs){ let b = -1; for (const ch of cs) { const i = this.indexOf(ch); if (i >= 0 && (b < 0 || i < b)) b = i; } return b; },
          Insert(i, s){ return this.slice(0, i) + S(s) + this.slice(i); },
          Remove(i, n){ return n === undefined ? this.slice(0, i) : this.slice(0, i) + this.slice(i + n); },
          PadLeft(n, ch = ' '){ return this.padStart(n, ch); }, PadRight(n, ch = ' '){ return this.padEnd(n, ch); },
          ToCharArray(){ return this.split(''); },
          Equals(s, c){ return ic(c) ? this.toLowerCase() === S(s).toLowerCase() : String(this) === s; },
          CompareTo(s){ return cmp0(String(this), s); },
        };
        for (const k of Object.keys(sx)) def(SP, k, sx[k]);
        for (const k of ['$Count', 'Any', 'All', 'Where', 'Select', 'First', 'FirstOrDefault', 'Last', 'LastOrDefault', 'Distinct', 'ToList', 'ToArray', 'Reverse', 'Sum', 'Max', 'Min', 'OrderBy', 'Take', 'Skip', 'ElementAt'])
          def(SP, k, function (...a) { return [...String(this)][k](...a); });
        for (const [k, i] of [['r', 0], ['g', 1], ['b', 2]]) defG(SP, k, function(){ return hexRgb(this)[i]; });
        defG(SP, 'a', function(){ return 1; });
      }
      // LINQ у словаря и множеств — через массив
      for (const C of [Dictionary, HashSet, Queue, Stack]) for (const k of Object.keys(L)) if (!(k in C.prototype) && !['Add', 'Remove', 'Clear', 'Insert', 'RemoveAt', 'Sort', 'Reverse', 'AddRange'].includes(k)) def(C.prototype, k, function (...a) { return [...this][k](...a); });
      // Vector3: как в Unity (неизменяемый: v.x = … переводится в v = новый вектор)
      defG(VP, 'magnitude', function(){ return this.Magnitude; });
      defG(VP, 'sqrMagnitude', function(){ return this.X * this.X + this.Y * this.Y + this.Z * this.Z; });
      defG(VP, 'normalized', function(){ const m = this.Magnitude; return m > 1e-5 ? new V3(this.X / m, this.Y / m, this.Z / m) : new V3(0, 0, 0); });
      def(VP, 'Normalize', function(){ return this.normalized; });
      def(VP, 'Dot', function (o){ return V3.Dot(this, o); });
      def(VP, 'Cross', function (o){ return V3.Cross(this, o); });
      def(VP, 'Equals', function (o){ return H.eq(this, o); });
      def(VP, 'ToString', function (f){ return f ? fmtAny(this, f) : S(this); });
      def(VP, 'Scale', function (o){ return V3.Scale(this, o); });
      function trimS(s, cs, m){
        s = String(s);
        if (!cs.length || (cs.length === 1 && Array.isArray(cs[0]) && !cs[0].length)) return m === 3 ? s.trim() : m === 1 ? s.trimStart() : s.trimEnd();
        const set = new Set([].concat(...cs.map(x => Array.isArray(x) ? x : [x])).map(S));
        let a = 0, b = s.length;
        if (m & 1) while (a < b && set.has(s[a])) a++;
        if (m & 2) while (b > a && set.has(s[b - 1])) b--;
        return s.slice(a, b);
      }

      // ── статические классы C# / Unity ──
      const Mathf = {
        PI: Math.PI, Infinity: Infinity, NegativeInfinity: -Infinity, Epsilon: 1.401298e-45, Deg2Rad: Math.PI / 180, Rad2Deg: 180 / Math.PI,
        Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Asin: Math.asin, Acos: Math.acos, Atan: Math.atan, Atan2: (y, x) => Math.atan2(y, x), Sqrt: Math.sqrt, Pow: Math.pow, Exp: Math.exp,
        Log: (x, b) => b === undefined ? Math.log(x) : Math.log(x) / Math.log(b), Log10: Math.log10,
        Floor: Math.floor, Ceil: Math.ceil, Round: bround, FloorToInt: x => Math.floor(x), CeilToInt: x => Math.ceil(x), RoundToInt: bround,
        Abs: Math.abs, Min: (...a) => Math.min(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a)), Max: (...a) => Math.max(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a)),
        Clamp: (v, a, b) => clamp(v, a, b), Clamp01: clamp01, Sign: x => x >= 0 ? 1 : -1,
        Lerp: (a, b, t) => a + (b - a) * clamp01(t), LerpUnclamped: (a, b, t) => a + (b - a) * t, InverseLerp: (a, b, v) => a !== b ? clamp01((v - a) / (b - a)) : 0,
        MoveTowards: (c, t, d) => Math.abs(t - c) <= d ? t : c + Math.sign(t - c) * d,
        Repeat: (t, l) => clamp(t - Math.floor(t / l) * l, 0, l),
        PingPong: (t, l) => { t = Mathf.Repeat(t, l * 2); return l - Math.abs(t - l); },
        DeltaAngle: (a, b) => { let d = Mathf.Repeat(b - a, 360); if (d > 180) d -= 360; return d; },
        LerpAngle: (a, b, t) => a + Mathf.DeltaAngle(a, b) * clamp01(t),
        MoveTowardsAngle: (c, t, d) => { const da = Mathf.DeltaAngle(c, t); return -d < da && da < d ? t : Mathf.MoveTowards(c, c + da, d); },
        SmoothStep: (a, b, t) => { t = clamp01(t); t = -2 * t * t * t + 3 * t * t; return b * t + a * (1 - t); },
        Approximately: (a, b) => Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1e-37),
        PerlinNoise: (x, y) => perlin(x, y),
        IsPowerOfTwo: n => n > 0 && (n & (n - 1)) === 0, NextPowerOfTwo: n => n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n)), ClosestPowerOfTwo: n => n <= 1 ? 1 : 2 ** Math.round(Math.log2(n)),
      };
      const hash2 = (x, y) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
      function perlin(x, y){
        const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
        const g = (ix, iy, dx, dy) => { const a = hash2(ix, iy) / 4294967296 * Math.PI * 2; return Math.cos(a) * dx + Math.sin(a) * dy; };
        const fade = t => t * t * t * (t * (t * 6 - 15) + 10), u = fade(xf), v = fade(yf);
        const a = g(xi, yi, xf, yf), b = g(xi + 1, yi, xf - 1, yf), c = g(xi, yi + 1, xf, yf - 1), d = g(xi + 1, yi + 1, xf - 1, yf - 1);
        const x1 = a + u * (b - a), x2 = c + u * (d - c);
        return clamp01((x1 + v * (x2 - x1)) * 0.7071 + 0.5);
      }
      const MathCs = {
        PI: Math.PI, E: Math.E, Tau: Math.PI * 2, Abs: Math.abs, Min: (a, b) => Math.min(a, b), Max: (a, b) => Math.max(a, b), Clamp: (v, a, b) => clamp(v, a, b),
        Sign: x => x > 0 ? 1 : x < 0 ? -1 : 0, Floor: Math.floor, Ceiling: Math.ceil, Truncate: Math.trunc,
        Round(x, d, mode){ if (typeof d !== 'number') { mode = d; d = 0; } const k = Math.pow(10, d || 0), y = x * k; return (mode === 'AwayFromZero' ? Math.sign(y) * Math.round(Math.abs(y)) : bround(y)) / k; },
        Sqrt: Math.sqrt, Pow: Math.pow, Exp: Math.exp, Log: (x, b) => b === undefined ? Math.log(x) : Math.log(x) / Math.log(b), Log10: Math.log10, Log2: Math.log2,
        Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Asin: Math.asin, Acos: Math.acos, Atan: Math.atan, Atan2: (y, x) => Math.atan2(y, x), Cbrt: Math.cbrt,
      };
      class Random {   // и System.Random (new Random(seed).Next), и UnityEngine.Random (Random.Range)
        constructor(seed){ this.$s = seed === undefined ? null : ((seed | 0) || 1); }
        $n(){ if (this.$s === null) return Math.random(); let t = (this.$s = (this.$s + 0x6D2B79F5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
        Next(a, b){ if (a === undefined) return Math.floor(this.$n() * 2147483647); if (b === undefined) { b = a; a = 0; } return b <= a ? a : a + Math.floor(this.$n() * (b - a)); }
        NextDouble(){ return this.$n(); }
        NextSingle(){ return this.$n(); }
        static Range(a, b){ return Number.isInteger(a) && Number.isInteger(b) ? Random.RangeI(a, b) : Random.RangeF(a, b); }
        static RangeI(a, b){ a = Math.trunc(a); b = Math.trunc(b); return b <= a ? a : a + Math.floor(Math.random() * (b - a)); }
        static RangeF(a, b){ return a + Math.random() * (b - a); }
        static get value(){ return Math.random(); }
        static get insideUnitSphere(){ for (;;) { const v = new V3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); if (v.sqrMagnitude <= 1) return v; } }
        static get onUnitSphere(){ for (;;) { const v = Random.insideUnitSphere; if (v.sqrMagnitude > 1e-6) return v.normalized; } }
        static get insideUnitCircle(){ for (;;) { const v = new V3(Math.random() * 2 - 1, Math.random() * 2 - 1, 0); if (v.sqrMagnitude <= 1) return v; } }
        static get rotation(){ return new V3(Math.random() * 360, Math.random() * 360, Math.random() * 360); }
        static ColorHSV(h0 = 0, h1 = 1, s0 = 0, s1 = 1, v0 = 0, v1 = 1){ const r = (a, b) => a + Math.random() * (b - a); return env.Color3.fromHSV(r(h0, h1), r(s0, s1), r(v0, v1)); }
        static InitState(){}
      }
      const T0 = Date.now();
      const Time = {
        get time(){ return (Date.now() - T0) / 1000; }, deltaTime: 1 / 60, fixedDeltaTime: 0.02, frameCount: 0, timeScale: 1,
        get smoothDeltaTime(){ return this.deltaTime; }, get unscaledDeltaTime(){ return this.deltaTime; }, get unscaledTime(){ return this.time; },
        get timeSinceLevelLoad(){ return this.time; }, get realtimeSinceStartup(){ return this.time; }, get fixedTime(){ return this.time; },
      };
      const Str = {
        Format(f, ...a){
          if (a.length === 1 && Array.isArray(a[0]) && /\{[1-9]/.test(f)) a = a[0];
          return S(f).replace(/\{\{|\}\}|\{(\d+)(?:,\s*(-?\d+))?(?::([^}]*))?\}/g, (m, i, al, fm) => {
            if (m === '{{') return '{'; if (m === '}}') return '}';
            if (+i >= a.length) throw new EX.FormatException('в строке формата {' + i + '}, а значений только ' + a.length);
            const s = fm !== undefined ? fmtAny(a[+i], fm) : S(a[+i]);
            return al !== undefined ? H.al(s, +al) : s;
          });
        },
        Join(sep, ...xs){ if (xs.length === 1 && xs[0] != null && typeof xs[0] === 'object' && typeof xs[0][Symbol.iterator] === 'function') xs = [...xs[0]]; return xs.map(S).join(S(sep)); },
        Concat(...xs){ if (xs.length === 1 && xs[0] != null && typeof xs[0] === 'object' && typeof xs[0][Symbol.iterator] === 'function') xs = [...xs[0]]; return xs.map(S).join(''); },
        IsNullOrEmpty: s => s == null || s === '', IsNullOrWhiteSpace: s => s == null || !String(s).trim(),
        Equals: (a, b, c) => ic(c) ? S(a).toLowerCase() === S(b).toLowerCase() : a === b,
        Compare: (a, b, c) => cmp0(ic(c) ? S(a).toLowerCase() : a, ic(c) ? S(b).toLowerCase() : b), CompareOrdinal: (a, b) => a < b ? -1 : a > b ? 1 : 0,
        Empty: '',
      };
      const mkInt = (min, max) => ({ MaxValue: max, MinValue: min,
        Parse(s){ const t = S(s).trim(); if (!/^[+-]?\d+$/.test(t)) throw new EX.FormatException('«' + S(s) + '» — не целое число'); const n = parseInt(t, 10); if (n < min || n > max) throw new EX.OverflowException('число ' + t + ' вне диапазона'); return n; },
        TryParse(s, b){ try { b.v = this.Parse(s); return true; } catch (e) { b.v = 0; return false; } } });
      const mkFlt = (max, eps) => ({ MaxValue: max, MinValue: -max, Epsilon: eps, PositiveInfinity: Infinity, NegativeInfinity: -Infinity, NaN: NaN,
        Parse(s){ const t = S(s).trim().replace(',', '.'); if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) throw new EX.FormatException('«' + S(s) + '» — не число'); return parseFloat(t); },
        TryParse(s, b){ try { b.v = this.Parse(s); return true; } catch (e) { b.v = 0; return false; } },
        IsNaN: x => Number.isNaN(x), IsInfinity: x => x === Infinity || x === -Infinity, IsPositiveInfinity: x => x === Infinity, IsNegativeInfinity: x => x === -Infinity, IsFinite: x => Number.isFinite(x) });
      const Bool = { TrueString: 'True', FalseString: 'False',
        Parse(s){ const t = S(s).trim().toLowerCase(); if (t === 'true') return true; if (t === 'false') return false; throw new EX.FormatException('«' + S(s) + '» — не true/false'); },
        TryParse(s, b){ try { b.v = this.Parse(s); return true; } catch (e) { b.v = false; return false; } } };
      const re1 = r => c => typeof c === 'string' && c.length > 0 && r.test(c[0]);
      const Char = { IsDigit: re1(/[0-9]/), IsLetter: re1(/\p{L}/u), IsLetterOrDigit: re1(/[\p{L}\p{Nd}]/u), IsUpper: re1(/\p{Lu}/u), IsLower: re1(/\p{Ll}/u), IsWhiteSpace: re1(/\s/),
        IsPunctuation: re1(/\p{P}/u), IsNumber: re1(/\p{N}/u), IsSymbol: re1(/\p{S}/u), IsControl: re1(/\p{Cc}/u), IsSeparator: re1(/\p{Z}/u),
        ToUpper: c => S(c).toUpperCase(), ToLower: c => S(c).toLowerCase(), GetNumericValue: c => /^[0-9]$/.test(c) ? +c : -1, MaxValue: CH(0xFFFF), MinValue: CH(0) };
      const toInt = x => x == null ? 0 : typeof x === 'number' ? bround(x) : typeof x === 'boolean' ? (x ? 1 : 0) : typeof x === 'string' ? A.int.Parse(x) : bround(Number(x));
      const toFlt = x => x == null ? 0 : typeof x === 'string' ? A.double.Parse(x) : typeof x === 'boolean' ? (x ? 1 : 0) : Number(x);
      const Convert = { ToInt32: toInt, ToInt64: toInt, ToInt16: toInt, ToByte: toInt, ToSingle: toFlt, ToDouble: toFlt, ToDecimal: toFlt,
        ToString: (x, f) => typeof f === 'number' && typeof x === 'number' ? (Math.trunc(x) >>> 0).toString(f) : f !== undefined ? fmtAny(x, f) : S(x),
        ToBoolean: x => typeof x === 'string' ? Bool.Parse(x) : !!x, ToChar: x => typeof x === 'number' ? CH(x) : S(x)[0] };
      const ArrayCs = {
        IndexOf: (a, x) => a.IndexOf(x), LastIndexOf: (a, x) => a.LastIndexOf(x), Sort: (a, c) => { a.Sort(c); }, Reverse: a => { a.reverse(); },
        Resize(b, n){ const a = b.v || [], r = a.slice(0, n), z = dflt(a); while (r.length < n) r.push(z); b.v = r; },
        Copy(src, a, b, c, d){ if (d === undefined) { for (let i = 0; i < b; i++) a[i] = src[i]; } else { for (let i = 0; i < d; i++) b[c + i] = src[a + i]; } },
        Clear(a, i = 0, n = a.length){ const z = dflt(a); for (let k = i; k < i + n; k++) a[k] = z; },
        Fill: (a, v) => { a.fill(v); }, Exists: (a, f) => a.some(x => f(x)), Find: (a, f) => a.Find(f), FindIndex: (a, f) => a.FindIndex(f), FindAll: (a, f) => a.FindAll(f),
        TrueForAll: (a, f) => a.every(x => f(x)), ForEach: (a, f) => { for (const x of a) f(x); }, Empty: () => [],
      };
      class List { static [Symbol.hasInstance](x){ return Array.isArray(x); } }
      class WaitForSeconds { constructor(s){ this.s = +s || 0; } }
      class WaitForSecondsRealtime extends WaitForSeconds {}
      class WaitUntil { constructor(f){ if (typeof f !== 'function') throw new TypeError(new.target.name + '(() => условие) — нужна лямбда'); this.f = f; } }
      class WaitWhile extends WaitUntil {}
      class WaitForEndOfFrame {}
      class WaitForFixedUpdate {}
      const Task = {
        Delay: ms => new Promise(r => setTimeout(r, Math.max(0, +ms || 0))),
        Yield: () => new Promise(r => nextFrame(r)),
        WhenAll: (...ps) => Promise.all(ps.length === 1 && Array.isArray(ps[0]) ? ps[0] : ps),
        WhenAny: (...ps) => Promise.race(ps.length === 1 && Array.isArray(ps[0]) ? ps[0] : ps),
        Run: f => Promise.resolve().then(() => f()),
        get CompletedTask(){ return Promise.resolve(); },
        FromResult: x => Promise.resolve(x),
      };
      const PP = new Map();
      const PlayerPrefs = { SetInt: (k, v) => { PP.set(S(k), v | 0); }, SetFloat: (k, v) => { PP.set(S(k), +v); }, SetString: (k, v) => { PP.set(S(k), S(v)); },
        GetInt: (k, d = 0) => PP.has(S(k)) ? PP.get(S(k)) : d, GetFloat: (k, d = 0) => PP.has(S(k)) ? PP.get(S(k)) : d, GetString: (k, d = '') => PP.has(S(k)) ? PP.get(S(k)) : d,
        HasKey: k => PP.has(S(k)), DeleteKey: k => { PP.delete(S(k)); }, DeleteAll: () => { PP.clear(); }, Save(){} };
      const Debug = {
        Log: m => env.print(S(m)), LogWarning: m => env.warn(S(m)), LogError: m => ctx0.send('print', { text: S(m).slice(0, 500), kind: 'err' }),
        LogFormat: (f, ...a) => env.print(Str.Format(f, ...a)), LogWarningFormat: (f, ...a) => env.warn(Str.Format(f, ...a)), LogErrorFormat: (f, ...a) => Debug.LogError(Str.Format(f, ...a)),
        LogException: e => Debug.LogError(csMsg(e)), Assert: (c, m) => { if (!c) Debug.LogError('Assert не прошёл' + (m !== undefined ? ': ' + S(m) : '')); },
        DrawLine(){}, DrawRay(){}, Break(){},
      };
      const Console = { WriteLine: (...a) => env.print(a.length > 1 ? Str.Format(...a) : S(a[0] === undefined ? '' : a[0])), Write: (...a) => env.print(a.length > 1 ? Str.Format(...a) : S(a[0])) };
      const Color = { red: '#ff0000', green: '#00ff00', blue: '#0000ff', white: '#ffffff', black: '#000000', yellow: '#ffeb04', cyan: '#00ffff', magenta: '#ff00ff',
        gray: '#808080', grey: '#808080', clear: '#000000', orange: '#ff8000',
        new: (r = 0, g = 0, b = 0) => rgbHex(r, g, b),
        LerpUnclamped: (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); },
        Lerp: (a, b, t) => Color.LerpUnclamped(a, b, clamp01(t)),
        HSVToRGB: (h, s, v) => env.Color3.fromHSV(h, s, v) };
      const Color32 = { new: (r = 0, g = 0, b = 0) => rgbHex(r / 255, g / 255, b / 255), Lerp: Color.Lerp };
      const Quaternion = { get identity(){ return V3.zero; }, Euler: (x, y, z) => isV(x) ? x : new V3(x, y, z),
        LookRotation: d => new V3(-Math.atan2(d.Y, Math.hypot(d.X, d.Z)) * 180 / Math.PI, Math.atan2(d.X, d.Z) * 180 / Math.PI, 0) };
      // ── уничтожить / клонировать / найти (Unity) ──
      function destroyAny(x, t){
        if (x == null) return;
        const go = () => {
          if (x instanceof CsScript) { kill(x); return; }
          const p = x.$go || x.$tf ? x.$p : x;
          if (typeof p.Destroy === 'function') p.Destroy();
        };
        if (t > 0) setTimeout(go, t * 1000); else go();
      }
      function instantiate(o, pos, rot){
        if (o == null) throw nre('Instantiate');
        const p = o.$go || o.$tf ? o.$p : o;
        if (typeof p.Clone !== 'function') throw new TypeError('Instantiate: нужна деталь мира (workspace.FindFirstChild(…))');
        const c = p.Clone();
        if (isV(pos)) c.Position = pos; else if (pos && (pos.$tf || pos.$go)) c.Parent = pos.$p;
        if (isV(rot)) c.Orientation = rot;
        return o.$go ? H.go(c) : o.$tf ? H.tf(c) : c;
      }
      function getComp(p, T, many){
        if (p == null) throw nre('GetComponent');
        if (p.$go || p.$tf) p = p.$p;
        if (T === 'Transform') return many ? [H.tf(p)] : H.tf(p);
        if (T === 'GameObject') return many ? [H.go(p)] : H.go(p);
        if (typeof T === 'string' && NOPE[T]) throw new EX.NotSupportedException(T + ': ' + NOPE[T]);
        const r = ALLI.filter(o => !o.$dead && o.$par === p && (typeof T !== 'function' || o instanceof T));
        return many ? r : r[0] || null;
      }
      function findObj(T, many){ const r = ALLI.filter(o => !o.$dead && (typeof T !== 'function' || o instanceof T)); return many ? r : r[0] || null; }
      const ObjectCs = { Destroy: destroyAny, Instantiate: instantiate, Equals: (a, b) => H.eq(a, b), ReferenceEquals: (a, b) => a === b, FindObjectOfType: T => findObj(T, false), FindObjectsOfType: T => findObj(T, true) };

      // ── кадры, корутины (IEnumerator + yield return), Update ──
      const FRQ = [], TICK = new Set(), ALLI = [];
      let CUR = null;
      let beatOn = false;
      function ensureBeat(){ if (beatOn) return; beatOn = true; env.RunService.Heartbeat.Connect(beat); }
      function nextFrame(f){ FRQ.push(f); ensureBeat(); }
      function beat(dt){
        if (dt > 0) Time.deltaTime = dt;
        Time.frameCount++;
        for (const o of TICK) {
          if (!alive(o) || o.enabled === false || INACTIVE.has(o.$par)) continue;
          if (o.$m.Update) callMsg(o, 'Update', [Time.deltaTime]);
          if (o.$m.FixedUpdate) callMsg(o, 'FixedUpdate', [Time.deltaTime]);
        }
        for (const f of FRQ.splice(0)) { try { f(); } catch (e) {} }
        for (const o of TICK) if (!o.$dead && o.enabled !== false && o.$m.LateUpdate) callMsg(o, 'LateUpdate', [Time.deltaTime]);
      }
      class Coroutine { constructor(it, owner, rt){ this.it = it; this.owner = owner; this.rt = rt; this.done = false; this.waiters = []; this.name = null; } }
      function coStart(it, owner, rt){
        if (it == null || typeof it.next !== 'function') throw new TypeError('StartCoroutine: нужен вызов метода IEnumerator, например StartCoroutine(Mig())');
        const co = new Coroutine(it, owner, rt);
        if (owner) { if (!owner.$cos) Object.defineProperty(owner, '$cos', { value: new Set() }); owner.$cos.add(co); }
        rt.cos.add(co);
        coStep(co);
        return co;
      }
      function coEnd(co){ if (co.done) return; co.done = true; if (co.owner && co.owner.$cos) co.owner.$cos.delete(co); co.rt.cos.delete(co); for (const f of co.waiters.splice(0)) f(); }
      function coStep(co, val){
        if (co.done) return;
        if (co.owner && !alive(co.owner)) { coEnd(co); return; }
        const rt = co.rt;
        if (rt.ctx.setCurrent) rt.ctx.setCurrent(rt.name);
        let r;
        try { r = co.it.next(val); } catch (e) { coEnd(co); rt.rep(e); return; }
        if (r.done) { coEnd(co); return; }
        coWait(co, r.value);
      }
      function coWait(co, y){
        const go = v => coStep(co, v);
        if (y == null || typeof y === 'number' || typeof y === 'boolean' || y instanceof WaitForEndOfFrame || y instanceof WaitForFixedUpdate) { nextFrame(go); return; }
        if (y instanceof WaitForSeconds) { setTimeout(go, Math.max(0, y.s * 1000)); return; }
        if (y instanceof WaitUntil) {
          const neg = y instanceof WaitWhile;
          const chk = () => { if (co.done) return; let ok; try { ok = !!y.f(); } catch (e) { coEnd(co); co.rt.rep(e); return; } if (neg) ok = !ok; if (ok) go(); else nextFrame(chk); };
          nextFrame(chk); return;
        }
        if (y instanceof Coroutine) { if (y.done) go(); else y.waiters.push(() => go()); return; }
        if (typeof y.next === 'function' && typeof y.throw === 'function') { const sub = coStart(y, co.owner, co.rt); if (sub.done) go(); else sub.waiters.push(() => go()); return; }
        if (typeof y.then === 'function') { y.then(v => go(v), e => { coEnd(co); co.rt.rep(e); }); return; }
        nextFrame(go);
      }
      function coStop(owner, x, rt){
        const set = owner ? owner.$cos : rt.cos;
        if (!set || x == null) return;
        for (const c of [...set]) if ((owner || !c.owner) && (c === x || c.it === x || (typeof x === 'string' && c.name === x))) coEnd(c);
      }
      // ── базовый класс Script / MonoBehaviour ──
      class CsScript {
        constructor(){
          this.enabled = true;
          if (CUR) Object.defineProperty(this, '$rt', { value: CUR });   // свой скрипт, даже если класс унаследован из другого
          const p = this.$rt.scr.Parent;
          Object.defineProperty(this, '$par', { value: p, writable: true });
          Object.defineProperty(this, '$pid', { value: (p && p.__id) || null, writable: true });
          ALLI.push(this);
        }
        get Parent(){ return this.$rt.scr.Parent; }
        get script(){ return this.$rt.scr; }
        get transform(){ return H.tf(this.Parent); }
        get gameObject(){ return H.go(this.Parent); }
        get name(){ return H.nm(this.Parent); } set name(v){ H.setnm(this.Parent, v); }
        get tag(){ return H.tag(this.Parent); } set tag(v){ H.settag(this.Parent, v); }
        StartCoroutine(x, ...a){
          if (typeof x === 'string') { const f = this[x]; if (typeof f !== 'function') throw new TypeError('StartCoroutine: нет метода «' + x + '»'); const c = coStart(f.apply(this, a), this, this.$rt); c.name = x; return c; }
          return coStart(x, this, this.$rt);
        }
        StopCoroutine(x){ coStop(this, x, this.$rt); }
        StopAllCoroutines(){ if (this.$cos) for (const c of [...this.$cos]) coEnd(c); }
        Invoke(n, t){ invokeLater(this, n, t, -1); }
        InvokeRepeating(n, t, r){ invokeLater(this, n, t, Math.max(0.01, +r || 0)); }
        CancelInvoke(n){ if (!this.$inv) return; for (const r of this.$inv.slice()) if (n === undefined || r.n === n) { clearTimeout(r.h); this.$inv.splice(this.$inv.indexOf(r), 1); } }
        IsInvoking(n){ return !!this.$inv && this.$inv.some(r => n === undefined || r.n === n); }
        Destroy(x, t){ destroyAny(x, t); }
        Instantiate(o, p, r){ return instantiate(o, p, r); }
        print(...a){ env.print(...a.map(S)); }
        CompareTag(t){ return H.ctag(this.Parent, t); }
        GetComponent(T){ return getComp(this.Parent, T, false); }
        GetComponents(T){ return getComp(this.Parent, T, true); }
        FindObjectOfType(T){ return findObj(T, false); }
        FindObjectsOfType(T){ return findObj(T, true); }
        ToString(){ return S(this.name) + ' (' + this.constructor.name + ')'; }
      }
      function invokeLater(o, n, t, rep){
        if (typeof o[n] !== 'function') throw new TypeError('Invoke: нет метода «' + n + '»');
        if (!o.$inv) Object.defineProperty(o, '$inv', { value: [] });
        const rec = { n, h: 0 };
        const fire = () => {
          if (!alive(o)) return;
          if (rep < 0) { const i = o.$inv.indexOf(rec); if (i >= 0) o.$inv.splice(i, 1); } else rec.h = setTimeout(fire, rep * 1000);
          callRaw(o, n, []);
        };
        rec.h = setTimeout(fire, Math.max(0, (+t || 0) * 1000));
        o.$inv.push(rec);
      }
      function alive(o){
        if (o.$dead) return false;
        if (o.$pid && !o.$rt.ctx.objs.has(o.$pid)) { kill(o); return false; }
        return true;
      }
      function kill(o){
        if (o.$dead) return;
        o.$dead = true; TICK.delete(o);
        if (o.$cos) for (const c of [...o.$cos]) coEnd(c);
        if (o.$inv) for (const r of o.$inv.splice(0)) clearTimeout(r.h);
        callMsg(o, 'OnDisable'); callMsg(o, 'OnDestroy');
      }
      function callRaw(o, n, a){
        const rt = o.$rt;
        if (rt.ctx.setCurrent) rt.ctx.setCurrent(rt.name);
        try {
          const r = o[n](...a);
          if (r && typeof r.next === 'function' && typeof r.throw === 'function') coStart(r, o, rt);
          else if (r && typeof r.then === 'function') r.then(null, e => rt.rep(e));
        } catch (e) { rt.rep(e); }
      }
      function callMsg(o, n, args){ const m = o.$m && o.$m[n]; if (m) callRaw(o, n, (args || []).slice(0, m[0])); }
      function wire(o){
        const m = o.$m, p = o.$par;
        if (m.Update || m.LateUpdate || m.FixedUpdate) { TICK.add(o); ensureBeat(); }
        const hit = (mt, h, pl) => mt[0] >= 2 ? [h, pl] : mt[1] === 'Player' ? [pl] : [h];
        const hook = (sig, names, args) => {
          const ns = names.filter(n => m[n]); if (!ns.length) return;
          const s = p && p !== env.workspace && typeof p.__id === 'string' ? p[sig] : null;
          if (!s || typeof s.Connect !== 'function') { o.$rt.ctx.error(ns[0] + ': положи скрипт внутрь детали — её касания и клики придут сюда', 0); return; }
          s.Connect((...a) => { if (!alive(o) || o.enabled === false || INACTIVE.has(p)) return; for (const n of ns) callRaw(o, n, args(m[n], ...a)); });
        };
        hook('Touched', ['OnTouched', 'OnTriggerEnter', 'OnCollisionEnter'], hit);
        hook('TouchEnded', ['OnTouchEnded', 'OnTriggerExit', 'OnCollisionExit'], hit);
        hook('Clicked', ['OnClicked', 'OnMouseDown'], (mt, pl) => mt[0] ? [pl] : []);
        if (m.OnPlayerAdded) { env.Players.PlayerAdded.Connect(pl => { if (alive(o)) callMsg(o, 'OnPlayerAdded', [pl]); }); if (o.$rt.late) for (const pl of env.Players.GetPlayers()) callMsg(o, 'OnPlayerAdded', [pl]); }
        if (m.OnPlayerRemoving) env.Players.PlayerRemoving.Connect(pl => { if (alive(o)) callMsg(o, 'OnPlayerRemoving', [pl]); });
      }
      // ── ошибки: строка C# по стеку (//# sourceURL=d37cs-N.js) и понятный текст ──
      let LB = 0, CB = 0;
      try { const o = {}; new Function('$', '$.e = new Error("p");\n//# sourceURL=d37cs-0.js')(o); const mm = /d37cs-0\.js:(\d+):(\d+)/.exec(String(o.e.stack)); if (mm) { LB = +mm[1]; CB = +mm[2] - 7; } } catch (e) {}
      if (Error.stackTraceLimit < 50) Error.stackTraceLimit = 50;
      function lineOf(rt, e){
        if (!LB) return 0;
        const mm = new RegExp('d37cs-' + rt.id + '\\.js:(\\d+):(\\d+)').exec(String(e && e.stack || ''));
        return mm ? mapLine(rt.map, +mm[1] - LB + 1, +mm[2] - CB) : 0;
      }
      function report(rt, e){
        try { if (e && typeof e === 'object') { if (e.$rep) return; Object.defineProperty(e, '$rep', { value: true, configurable: true }); } } catch (x) {}
        const line = lineOf(rt, e), msg = csMsg(e), key = line + '|' + msg, now = Date.now();
        if (rt.seen.has(key) && now - rt.seen.get(key) < 5000) return;   // ошибка в Update — не 60 раз в секунду
        rt.seen.set(key, now);
        rt.ctx.error(msg, line);
      }
      function csMsg(e, short){
        if (e == null) return 'Exception: null';
        if (typeof e !== 'object') return S(e);
        const m = String(e.message || '');
        if (e instanceof Exception) return short ? m : e.$type + ': ' + m;
        let t = null, msg = m, r;
        if ((r = /Cannot read propert(?:y|ies) of (?:null|undefined)(?: \(reading '([^']*)'\))?/.exec(m)) || (r = /can't access property "([^"]*)",? .* is (?:null|undefined)/.exec(m)) ||
          (r = /(?:null|undefined) is not an object \(evaluating '[^']*?\.?([^'.]*)'\)/.exec(m))) { t = 'NullReferenceException'; msg = 'обращение к «' + (r[1] || '?') + '» у пустого значения (null)'; }
        else if ((r = /Cannot set propert(?:y|ies) of (?:null|undefined)(?: \(setting '([^']*)'\))?/.exec(m))) { t = 'NullReferenceException'; msg = 'запись «' + (r[1] || '?') + '» в пустое значение (null)'; }
        else if ((r = /([\w$.\]\[]+) is not a function/.exec(m))) msg = 'нет метода «' + r[1].split('.').pop() + '» (или это не метод)';
        else if (/is not iterable/.test(m)) msg = 'foreach: это нельзя перебрать';
        else if (/Assignment to constant variable/.test(m)) msg = 'эту переменную менять нельзя';
        else if ((r = /Cannot set property (\S+) of .* which has only a getter/.exec(m))) msg = 'свойство «' + r[1] + '» только для чтения';
        else if (/Maximum call stack|too much recursion/i.test(m)) { t = 'StackOverflowException'; msg = 'бесконечная рекурсия: метод вызывает сам себя без конца'; }
        else if (/Invalid array length/.test(m)) { t = 'OverflowException'; msg = 'слишком большой массив'; }
        return short || !t ? msg : t + ': ' + msg;
      }
      for (const k of Object.keys(EX)) EX[k].$exc = true;

      // ── всё, что видит код C# по имени ──
      const A = {
        game: env.game, workspace: env.workspace, Enum: env.Enum, Instance: env.Instance, TweenService: env.TweenService, TweenInfo: env.TweenInfo, RunService: env.RunService,
        Players: env.Players, Debris: env.Debris, gui: env.gui, sound: env.sound, wait: env.wait, random: env.random, Color3: env.Color3,
        print: (...a) => env.print(...a.map(S)), warn: (...a) => env.warn(...a.map(S)),
        Vector3: V3, Color, Color32, Mathf, Math: MathCs, MathF: MathCs, Debug, Console, Random, Time, Quaternion, Space: { World: 1, Self: 0 }, PlayerPrefs,
        GameObject: { Find: n => env.workspace.FindFirstChild(S(n), true) },
        StringSplitOptions: { None: 0, RemoveEmptyEntries: 1, TrimEntries: 2 }, MidpointRounding: { ToEven: 'ToEven', AwayFromZero: 'AwayFromZero' },
        StringComparison: { CurrentCulture: 0, CurrentCultureIgnoreCase: 1, InvariantCulture: 2, InvariantCultureIgnoreCase: 3, Ordinal: 4, OrdinalIgnoreCase: 5 },
        Array: ArrayCs, Enumerable: { Range: (s, n) => Array.from({ length: Math.max(0, n) }, (_, i) => s + i), Repeat: (x, n) => new Array(Math.max(0, n)).fill(x), Empty: () => [] },
        Convert, string: Str, bool: Bool, char: Char, object: ObjectCs, Task,
        int: mkInt(-2147483648, 2147483647), long: mkInt(-9007199254740991, 9007199254740991), short: mkInt(-32768, 32767), byte: mkInt(0, 255), sbyte: mkInt(-128, 127),
        uint: mkInt(0, 4294967295), ulong: mkInt(0, 9007199254740991), ushort: mkInt(0, 65535),
        float: mkFlt(3.4028235e38, 1.401298e-45), double: mkFlt(Number.MAX_VALUE, Number.MIN_VALUE), decimal: mkFlt(7.9228162514264337e28, 1e-28),
        List, Dictionary, HashSet, Queue, Stack, KeyValuePair: { Create: (k, v) => new KVP(k, v) }, StringBuilder,
        WaitForSeconds, WaitForSecondsRealtime, WaitUntil, WaitWhile, WaitForEndOfFrame, WaitForFixedUpdate,
        Destroy: destroyAny, Instantiate: instantiate, FindObjectOfType: T => findObj(T, false), FindObjectsOfType: T => findObj(T, true),
        ...EX,
      };
      function mkScript(id, map, env2, ctx, late){   // $ одного скрипта
        const rt = Object.create(H);
        Object.assign(rt, { id, map, ctx, name: ctx.name, env: env2, scr: env2.script, seen: new Map(), cos: new Set(), late: !!late });
        const A2 = Object.create(A);
        if (late) {   // скрипт запущен позже (ждал классы из других скриптов): уже вошедшие игроки — тоже «PlayerAdded»
          const P = env2.Players;
          A2.Players = Object.assign(Object.create(P), { PlayerAdded: { Connect(fn){ const c = P.PlayerAdded.Connect(fn); for (const pl of P.GetPlayers()) fn(pl); return c; }, Wait: () => P.PlayerAdded.Wait() } });
        }
        A2.script = env2.script; A2.Parent = env2.script.Parent;
        A2.task = { wait: env2.task.wait, spawn: (f, ...a) => env2.task.spawn(rt.guard(f), ...a), delay: (s, f, ...a) => env2.task.delay(s, rt.guard(f), ...a) };
        A2.StartCoroutine = x => coStart(x, null, rt);
        A2.StopCoroutine = x => coStop(null, x, rt);
        A2.StopAllCoroutines = () => { for (const c of [...rt.cos]) if (!c.owner) coEnd(c); };
        rt.A = A2;
        const Sc = class extends CsScript {};
        Object.defineProperty(Sc.prototype, '$rt', { value: rt });
        rt.Script = Sc;
        return rt;
      }
      function start(mod, rt){
        const insts = [];
        for (const [Cls, , meta] of mod.scripts) {
          let o;
          CUR = rt;
          try { o = new Cls(); } catch (e) { rt.rep(e); continue; } finally { CUR = null; }
          Object.defineProperty(o, '$m', { value: meta });
          insts.push(o);
        }
        for (const o of insts) callMsg(o, 'Awake');
        if (mod.main) { if (rt.ctx.setCurrent) rt.ctx.setCurrent(rt.name); try { const pr = mod.main(); if (pr && typeof pr.then === 'function') pr.then(null, e => rt.rep(e)); } catch (e) { rt.rep(e); } }
        for (const o of insts) callMsg(o, 'OnEnable');
        for (const o of insts) callMsg(o, 'Start');
        for (const o of insts) wire(o);
      }
      RT = { V3B, V3, H, A, EX, mkScript, start, Time };
      return RT;
    }
    function mapLine(map, L, C){   // строка:столбец JS → строка C#
      for (let i = Math.min(L, map.length) - 1; i >= 0; i--) {
        const row = map[i];
        if (!row || !row.length) continue;
        if (i === L - 1) { let best = 0; for (const [c, l] of row) if (c <= C - 1) best = l; if (best) return best; continue; }
        return row[row.length - 1][1];
      }
      return 0;
    }

    // ═══ 5. Запуск: D37Lang.cs.run(код, env, ctx) — один раз на скрипт при «▶ Играть» ═══
    // классы общие для всех C#-скриптов запуска (как одна сборка в Unity): XC — для перевода, XR — сами классы
    const XC = new Map(), XR = new Map(), WAITQ = [];
    let NRUN = 0, waitOn = false;
    function run(code, env, ctx){
      boot(env, ctx);
      let C;
      try { C = compile(code, XC); }
      catch (e) {
        if (e && e.cs && e.unk) { WAITQ.push([code, env, ctx]); if (!waitOn) { waitOn = true; Promise.resolve().then(flushWait); } return; }   // класс из скрипта ниже — переведём после всех
        report0(ctx, e); return;
      }
      startC(C, env, ctx, false);
    }
    function report0(ctx, e){ if (e && e.cs) ctx.error(e.message, e.line); else ctx.error('Ошибка переводчика C#: ' + String(e && e.message || e), 0); }
    function startC(C, env, ctx, late){
      const R = boot(env, ctx);
      for (const [n, info] of C.types) XC.set(n, info);
      const id = ++NRUN, rt = R.mkScript(id, C.map, env, ctx, late);
      let mod;
      try { mod = new Function('$', C.js + '\n//# sourceURL=d37cs-' + id + '.js')(rt); }
      catch (e) { if (e instanceof SyntaxError) ctx.error('C#: переводчик собрал неверный код (сообщи разработчику): ' + e.message, 0); else rt.rep(e); return; }
      for (const n of Object.keys(mod.classes || {})) XR.set(n, mod.classes[n]);
      R.start(mod, rt);
    }
    function flushWait(){   // скрипты, ждавшие классы из других скриптов: переводим, пока получается
      waitOn = false;
      let list = WAITQ.splice(0), more = true;
      while (more && list.length) {
        more = false;
        const rest = [];
        for (const it of list) { let C; try { C = compile(it[0], XC); } catch (e) { if (e && e.cs && e.unk) { rest.push(it); continue; } report0(it[2], e); more = true; continue; } more = true; startC(C, it[1], it[2], true); }
        list = rest;
      }
      for (const it of list) { try { compile(it[0], XC); } catch (e) { report0(it[2], e); } }
    }
    globalThis.D37Lang = globalThis.D37Lang || {};
    globalThis.D37Lang.cs = { run, compile, mapLine, api: () => RT && RT.A, table: () => API };
  }

  // ═══ Примеры (как в Roblox: «вставь и поменяй») и задание для ИИ ═══
  const EXAMPLES = [
    ['Монетка: +1 очко и исчезает', `// Положи этот скрипт в деталь-монетку
var coin = script.Parent;
coin.Touched += (hit, player) =>
{
    if (player == null) return;
    player.AddStat("Монеты", 1);
    sound.play("coin");
    coin.Destroy();
};`],
    ['Лава: касание — смерть', `// Положи в красную деталь (материал «Неон»)
script.Parent.Touched += (hit, player) =>
{
    if (player != null) player.Humanoid.Health = 0;
};`],
    ['Дверь: [E] открыть / закрыть', `// Положи в деталь-дверь
var door = script.Parent;
Vector3 closed = door.Position;
bool open = false;

door.Prompt("Открыть дверь").Triggered += player =>
{
    open = !open;
    Vector3 to = open ? closed + new Vector3(0, door.Size.y, 0) : closed;
    TweenService.Create(door, new TweenInfo(0.6f), new { Position = to }).Play();
    sound.play(open ? "door_wood_open" : "door_wood_close");
};`],
    ['Движущаяся платформа (TweenService)', `// Платформа ездит туда-сюда, игрок едет на ней
var p = script.Parent;
// время 3 с, плавно, повторять бесконечно (-1) и ехать обратно
var info = new TweenInfo(3f, Enum.EasingStyle.Sine, null, -1, true);
TweenService.Create(p, info, new { Position = p.Position + new Vector3(0, 0, 12) }).Play();`],
    ['Крутилка: класс как в Unity, Update', `public class Spinner : Script
{
    public float speed = 90f;   // градусов в секунду

    void Update(float dt)
    {
        Vector3 r = Parent.Orientation;
        Parent.Orientation = new Vector3(r.x, (r.y + speed * dt) % 360f, r.z);
    }
}`],
    ['Шипы: OnTouched в классе', `public class Spikes : Script
{
    public int damage = 25;
    float lastHit = -10f;

    void OnTouched(Part hit, Player player)
    {
        if (player == null || Time.time - lastHit < 1f) return;   // не чаще раза в секунду
        lastHit = Time.time;
        player.Humanoid.TakeDamage(damage);
        player.Message($"Ай! −{damage} здоровья", 1);
    }
}`],
    ['Мигалка: корутина и WaitForSeconds', `using System.Collections;

public class Blinker : Script
{
    void Start()
    {
        StartCoroutine(Blink());
    }

    IEnumerator Blink()
    {
        while (true)
        {
            Parent.Transparency = 0.8f;
            yield return new WaitForSeconds(0.5f);
            Parent.Transparency = 0f;
            yield return new WaitForSeconds(0.5f);
        }
    }
}`],
    ['Кнопка-ловушка: async и await', `// Положи в деталь-кнопку. Рядом — деталь «Пол»
var floor = workspace.FindFirstChild("Пол", true);

script.Parent.Prompt("Нажать").Triggered += async player =>
{
    if (floor == null) return;
    floor.Transparency = 0.7f;
    floor.CanCollide = false;      // пол исчез на 3 секунды
    await Task.Delay(3000);
    floor.Transparency = 0f;
    floor.CanCollide = true;
};`],
    ['При входе: приветствие и очки', `// Положи в Workspace (без родителя)
Players.PlayerAdded += player =>
{
    player.SetStat("Монеты", 0);
    player.Message($"Привет, {player.Name}! Собери все монетки 🪙", 4);
};`],
    ['Финиш: таймер и рекорд', `// Положи в деталь «Финиш»
bool done = false;

script.Parent.Touched += (hit, player) =>
{
    if (player == null || done) return;
    done = true;
    float t = Time.time;
    gui.message($"🏁 {player.Name} прошёл за {t:F1} с!", 5);
    player.SetStat("Время", Math.Round(t, 1));
    sound.play("coin");
};`],
  ];
  const AI = `Напиши скрипт на C# для «Студии 3D» сайта dan4ik37 (как Roblox Studio; C# переводится в JavaScript прямо в браузере, поэтому используй только то, что перечислено).
Два стиля (выбери один):
1) Код верхнего уровня (C# 9): script.Parent — объект, в котором лежит скрипт. Пример: script.Parent.Touched += (hit, player) => { player.AddStat("Монеты", 1); script.Parent.Destroy(); };
2) Класс как в Unity: public class Имя : Script { … } с методами Start(), Update(float dt), OnTouched(Part hit, Player player), OnTouchEnded(Part hit, Player player), OnClicked(Player player), OnPlayerAdded(Player player). Внутри: Parent (деталь со скриптом), transform.position / Rotate / Translate, StartCoroutine(Метод()) — корутина IEnumerator с yield return new WaitForSeconds(сек) или yield return null (кадр), Invoke("Метод", сек), Destroy(деталь).
Мир (имена как в Roblox): workspace.FindFirstChild("Имя", true), Instance.new("Part", workspace), деталь.Clone(), деталь.Destroy(); свойства детали: Name, Position, Size, Orientation (Vector3, градусы), Color (Color.red, new Color(1, 0.5f, 0), Color3.fromRGB(255, 0, 0)), Material ("plastic", "neon", "wood", "glass", "metal", "brick", "grass", "sand", "ice"), Transparency (0–1), CanCollide, Anchored (false — деталь падает).
События: деталь.Touched += (hit, player) => …; деталь.TouchEnded; деталь.Clicked += player => …; деталь.Prompt("Текст").Triggered += player => …; RunService.Heartbeat += dt => …; Players.PlayerAdded += player => … (отписка — -=).
Игрок: player.Name, player.Position, player.Humanoid.Health / MaxHealth (100) / WalkSpeed (16) / JumpPower (50), player.Humanoid.TakeDamage(n), player.Teleport(new Vector3(x, y, z)), player.SetStat("Имя", число) / AddStat / GetStat (таблица очков), player.Message("текст", секунды).
Плавно: TweenService.Create(деталь, new TweenInfo(секунды, Enum.EasingStyle.Sine, null, повторы (-1 — всегда), обратно (true/false)), new { Position = v, Transparency = 0.5f }).Play().
Ещё можно: Vector3 (+ - * /, Vector3.up, Vector3.Distance, Vector3.Lerp, v.magnitude, v.normalized), Mathf (Sin, Abs, Clamp, Lerp, PingPong, Round…), Math, Random.Range(a, b), Time.time, Time.deltaTime, Debug.Log, строки $"…{x:F1}…", List<T>, Dictionary<K, V>, LINQ (Where, Select, Sum, OrderBy…), async/await с await Task.Delay(миллисекунды), gui.message("текст", сек), gui.text("ключ", "текст"), sound.play("coin" | "jump" | "hit" | "click" | "pickup" | "buzz" | "door_wood_open" | "door_wood_close" | "break").
Нельзя: Input, Rigidbody, Physics, Camera, GetComponent<Rigidbody>, UI-классы Unity, Vector2, Quaternion-математика, сеть, файлы, потоки (Thread), LINQ-запросы from…select, goto, unsafe, record. using и namespace не нужны.
Задача: `;
  const def = { label: 'C# (как в Unity)', short: 'C#', icon: '♯', kind: 'text', worker, examples: EXAMPLES, ai: AI,
    placeholder: '// C# как в Unity. script.Parent — объект, в котором лежит скрипт.\n// Нажми «📚 Примеры», чтобы вставить готовый.' };
  if (typeof E.lang === 'function') E.lang('cs', def);
  else { E.langs = E.langs || {}; E.langs.cs = Object.assign({ id: 'cs' }, def); }
})();

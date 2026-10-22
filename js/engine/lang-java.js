// ═══════════════════════════════════════
//  JAVA ДЛЯ «СТУДИИ 3D» И МОДОВ — свой переводчик Java → JavaScript (без библиотек, без сети, без JVM)
// ═══════════════════════════════════════
// Как lang-cs.js: переводчик работает ВНУТРИ песочницы скриптов (worker() уходит туда текстом): лексер → парсер (дерево) →
// генератор JS со статическими типами → new Function. Каждый кусок JS помечен строкой Java (карта «строка:столбец JS → строка
// Java», //# sourceURL=d37java-N.js) — ошибки и при переводе, и во время игры приходят по-русски с номером строки Java.
// Числа как в Java: int — 32 бита с переполнением (|0, Math.imul), деление int — к нулю, (int) — к нулю с насыщением;
// long — ТОЧНЫЕ 64 бита (BigInt: 5L → 5n, в мир уходит обычным числом); float — Math.fround после каждой операции; char —
// строка из одного знака ('a' + 1 = 98, (char) 98 = 'b'); печать double/float как Double.toString / Float.toString (1.0, 1.0E10).
// Поля объектов Java хранятся под ключом '#имя' (у Java поле и метод могут называться одинаково: record Point(int x) → x и x()).
// Перегрузки методов и конструкторов выбираются при переводе по типам аргументов (как javac), если типы неизвестны — во время работы.
// wait(сек) / Thread.sleep(мс) / task.wait(сек) ждут «по-настоящему»: функция, которая ждёт (или вызывает такую), становится
// генератором (function*) и идёт сопрограммой — как корутины Unity, только писать ничего не нужно.
// Стили: 1) код верхнего уровня (как JShell / «компактные файлы» Java 25: void main() { … }, поля и методы без класса);
// 2) класс public static void main(String[] args); 3) class X extends Script { start(), update(double dt), onTouched(…) … }.
// Моды «Кубомира» и «Подземья»: тот же язык + фасад Fabric/Forge (Registry.register, Block, Item, ServerTickEvents …) поверх
// API модов (docs/MODS.md). Не поддерживается: потоки и synchronized, рефлексия, java.io/nio, сеть, Scanner (ввода нет).
// Тесты: node scripts/lang-java-test.cjs
(() => {
  const E = window.D37E = window.D37E || {};

  // ═══ Всё, что ниже, работает внутри песочницы. Снаружи эта функция ничего не видит ═══
  function worker(){
    'use strict';
    const CH = String.fromCharCode;
    const MK = CH(1), MK2 = CH(2);                 // метка строки Java в тексте JS: MK + строка + MK2
    const mark = line => MK + line + MK2;
    function JErr(msg, line){ const e = new Error(msg); e.java = true; e.line = line || 0; return e; }

    // ═══ 1. Лексер: текст → токены { k: id|kw|num|str|chr|op|eof, v, line, s, e } ═══
    const KW = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally ' +
      'float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp ' +
      'super switch synchronized this throw throws transient try void volatile while true false null').split(' '));
    const PRIMS = new Set(['int', 'long', 'short', 'byte', 'char', 'float', 'double', 'boolean']);
    const OPS3 = ['...', '<<='];
    const OPS2 = ['->', '::', '++', '--', '&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<'];
    const OPS1 = '{}()[];,.@=><!~?:+-*/&|^%';
    const isD = c => c >= '0' && c <= '9';
    const isHex = c => isD(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    const isIdS = c => !!c && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$' || (c.charCodeAt(0) > 127 && /\p{L}/u.test(c)));
    const isIdC = c => !!c && (isIdS(c) || isD(c) || (c.charCodeAt(0) > 127 && /[\p{N}\p{Mn}\p{Mc}\p{Pc}]/u.test(c)));
    const ESC = { b: CH(8), t: '\t', n: '\n', f: CH(12), r: '\r', s: ' ', '"': '"', "'": "'", '\\': '\\' };
    const I32 = 2147483648, B63 = 9223372036854775808n;

    function lex(src){
      const T = [], n = src.length;
      let i = 0, line = 1, ws = true;
      const tok = (k, v, s, tl, x) => { const t = { k, v, line: tl, s, e: i, ws }; if (x) Object.assign(t, x); T.push(t); ws = false; return t; };
      function esc(tl){   // src[i] === '\\' → символ
        const d = src[i + 1];
        if (d !== undefined && Object.prototype.hasOwnProperty.call(ESC, d)) { i += 2; return ESC[d]; }
        if (d >= '0' && d <= '7') {
          let j = i + 1, s = '';
          const max = d <= '3' ? 3 : 2;
          while (s.length < max && src[j] >= '0' && src[j] <= '7') s += src[j++];
          i = j; return CH(parseInt(s, 8));
        }
        if (d === 'u') {
          let j = i + 1; while (src[j] === 'u') j++;
          const h = src.slice(j, j + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) throw JErr('Неверная escape-последовательность \\u — нужно 4 шестнадцатеричные цифры, например \\u0041', tl);
          i = j + 4; return CH(parseInt(h, 16));
        }
        throw JErr('Неизвестная escape-последовательность \\' + (d === undefined ? '' : d) + ' (обратная косая черта пишется \\\\)', tl);
      }
      function textBlock(tl){   // """ … """ (Java 15): общий отступ убирается, пробелы в конце строк — тоже
        i += 3;
        while (src[i] === ' ' || src[i] === '\t' || src[i] === '\f') i++;
        if (src[i] === '\r') i++;
        if (src[i] !== '\n') throw JErr('После """ сразу перенос строки: текстовый блок начинается со следующей строки', line);
        i++; line++;
        const st = i;
        for (;;) {
          if (i >= n) throw JErr('Незакрытый текстовый блок """ (начало на строке ' + tl + ')', tl);
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"') break;
          if (src[i] === '\n') line++;
          i++;
        }
        const raw = src.slice(st, i).replace(/\r\n?/g, '\n');
        i += 3;
        let L = raw.split('\n');
        const last = L[L.length - 1], own = /^[ \t\f]*$/.test(last);
        let min = Infinity;
        L.forEach((l, k) => { const blank = /^[ \t\f]*$/.test(l); if (!blank || (k === L.length - 1 && own)) min = Math.min(min, /^[ \t\f]*/.exec(l)[0].length); });
        if (min === Infinity) min = 0;
        L = L.map(l => /^[ \t\f]*$/.test(l) ? '' : l.slice(min).replace(/[ \t\f]+$/, ''));
        const txt = L.join('\n');
        let out = '';
        for (let k = 0; k < txt.length; k++) {
          const c = txt[k];
          if (c !== '\\') { out += c; continue; }
          if (txt[k + 1] === '\n') { k++; continue; }   // \ в конце строки — без переноса
          const save = i, sv = src;
          // escape внутри уже обработанного текста — разбираем тем же кодом
          src = txt; i = k; const ch = esc(tl); k = i - 1; src = sv; i = save;
          out += ch;
        }
        return out;
      }
      while (i < n) {
        const c = src[i], cc = src.charCodeAt(i);
        if (c === '\n') { line++; i++; ws = true; continue; }
        if (c === ' ' || c === '\t' || c === '\r' || cc === 11 || cc === 12 || cc === 0xA0 || cc === 0xFEFF || (cc >= 0x2000 && cc <= 0x200B) || cc === 0x3000 || cc === 0x202F) { i++; ws = true; continue; }
        if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; ws = true; continue; }
        if (c === '/' && src[i + 1] === '*') {
          const l0 = line; i += 2;
          while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
          if (i >= n) throw JErr('Незакрытый комментарий /* … */', l0);
          i += 2; ws = true; continue;
        }
        const s = i, tl = line;
        // ── числа: 12, 1.5f, 2d, 10L, 0xFF, 0b101, 017 (восьмеричное), 1_000, 1e3 ──
        if (isD(c) || (c === '.' && isD(src[i + 1]))) {
          let real = false, base = 10;
          if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
            i += 2; base = 16; while (i < n && (isHex(src[i]) || src[i] === '_')) i++;
            if (src[i] === '.' || src[i] === 'p' || src[i] === 'P') throw JErr('Шестнадцатеричные дробные числа (0x1.8p3) не поддерживаются — пиши обычное число', line);
          } else if (c === '0' && (src[i + 1] === 'b' || src[i + 1] === 'B')) { i += 2; base = 2; while (i < n && (src[i] === '0' || src[i] === '1' || src[i] === '_')) i++; }
          else {
            while (i < n && (isD(src[i]) || src[i] === '_')) i++;
            if (src[i] === '.' && isD(src[i + 1])) { real = true; i++; while (i < n && (isD(src[i]) || src[i] === '_')) i++; }
            else if (src[i] === '.' && !isIdS(src[i + 1]) && src[i + 1] !== '.') { real = true; i++; }
            if ((src[i] === 'e' || src[i] === 'E') && (isD(src[i + 1]) || ((src[i + 1] === '+' || src[i + 1] === '-') && isD(src[i + 2])))) { real = true; i += 2; while (i < n && isD(src[i])) i++; }
          }
          const body = src.slice(s, i).replace(/_/g, '');
          let suf = '';
          if (/[lLfFdD]/.test(src[i] || '') && !(base !== 10 && /[fFdD]/.test(src[i]))) suf = src[i++].toLowerCase();
          if (isIdC(src[i])) throw JErr('Неверное число «' + src.slice(s, i + 1) + '»', line);
          if (base !== 10 && body.length <= 2) throw JErr('Неверное число «' + src.slice(s, i) + '»', line);
          if (suf === 'f' || suf === 'd' || real) {
            if (base !== 10) throw JErr('Неверное число «' + src.slice(s, i) + '»', line);
            const v = parseFloat(body);
            if (suf === 'f') {
              const f = Math.fround(v);
              if (!isFinite(f)) throw JErr('Число ' + body + ' слишком большое для float', line);
              if (f === 0 && v !== 0) throw JErr('Число ' + body + ' слишком маленькое для float', line);
              tok('num', f, s, tl, { nt: 'float' });
            } else {
              if (!isFinite(v)) throw JErr('Число ' + body + ' слишком большое для double', line);
              tok('num', v, s, tl, { nt: 'double' });
            }
            continue;
          }
          let b, octal = false;
          if (base === 16) b = BigInt('0x' + body.slice(2));
          else if (base === 2) b = BigInt('0b' + body.slice(2));
          else if (body.length > 1 && body[0] === '0') {
            if (!/^[0-7]+$/.test(body)) throw JErr('Число ' + body + ': в Java число с нулём впереди — восьмеричное, цифр 8 и 9 в нём нет (убери 0 в начале)', line);
            b = BigInt('0o' + body.slice(1)); octal = true;
          } else b = BigInt(body);
          const dec = base === 10 && !octal;
          if (suf === 'l') {
            if (dec ? b > B63 : b >= 1n << 64n) throw JErr('Число ' + body + 'L слишком большое для long', line);
            tok('num', dec && b === B63 ? b : BigInt.asIntN(64, b), s, tl, { nt: 'long', big: dec && b === B63 });
          } else {
            if (dec ? b > BigInt(I32) : b >= 1n << 32n) throw JErr('Число ' + body + ' слишком большое для int — добавь L (long): ' + body + 'L', line);
            tok('num', dec && b === BigInt(I32) ? I32 : Number(BigInt.asIntN(32, b)), s, tl, { nt: 'int', big: dec && b === BigInt(I32) });
          }
          continue;
        }
        // ── строки "…" и текстовые блоки """…""" ──
        if (c === '"') {
          if (src[i + 1] === '"' && src[i + 2] === '"') { tok('str', textBlock(tl), s, tl); continue; }
          i++;
          let v = '';
          for (;;) {
            if (i >= n || src[i] === '\n' || src[i] === '\r') throw JErr('Незакрытая строка (нет второй кавычки ")', tl);
            const d = src[i];
            if (d === '"') { i++; break; }
            if (d === '\\') { v += esc(tl); continue; }
            v += d; i++;
          }
          tok('str', v, s, tl);
          continue;
        }
        // ── символ: 'a', '\n', 'A' ──
        if (c === "'") {
          i++;
          let v;
          if (src[i] === '\\') v = esc(tl);
          else { if (i >= n || src[i] === "'" || src[i] === '\n') throw JErr("Пустой символ '' — между апострофами ровно один знак", line); v = src[i]; i++; if (src.charCodeAt(i - 1) >= 0xD800 && src.charCodeAt(i - 1) <= 0xDBFF) throw JErr('Этот знак (эмодзи) не помещается в char — пиши его строкой "…"', line); }
          if (src[i] !== "'") throw JErr("В '…' — ровно один символ (строка пишется в двойных кавычках \"…\")", line);
          i++;
          tok('chr', v, s, tl);
          continue;
        }
        // ── имена и ключевые слова ──
        if (isIdS(c)) {
          while (i < n && isIdC(src[i])) i++;
          const v = src.slice(s, i);
          tok(KW.has(v) ? 'kw' : 'id', v, s, tl);
          continue;
        }
        // ── операторы (>> и >>= не склеиваем: List<List<Integer>> — склеивает парсер) ──
        let op = null;
        if (OPS3.includes(src.substr(i, 3))) op = src.substr(i, 3);
        else if (OPS2.includes(src.substr(i, 2))) op = src.substr(i, 2);
        else if (OPS1.includes(c)) op = c;
        if (op) { i += op.length; tok('op', op, s, tl); continue; }
        if (c === '`') throw JErr('Символ ` в Java не используется (строки — в кавычках "…")', line);
        if ('“”„«»‘’'.includes(c)) throw JErr('Кавычки «' + c + '» — типографские (из текста или мессенджера): в коде пиши обычные "…" и \'…\'', line);
        if (cc === 0x2212 || cc === 0x2013 || cc === 0x2014) throw JErr('Символ «' + c + '» — это не минус: в коде пиши обычный -', line);
        if (c === '#') throw JErr('Символ # в Java не используется (комментарий — // …)', line);
        throw JErr('Непонятный символ «' + c + '»', line);
      }
      T.push({ k: 'eof', v: '', line, s: i, e: i, ws: true });
      return T;
    }

    // ═══ 2. Парсер: токены → дерево. Выражения { k: … }, инструкции { s: … }, члены классов { m: … } ═══
    const MODS = new Set(['public', 'protected', 'private', 'static', 'abstract', 'final', 'native', 'transient', 'volatile', 'strictfp', 'default', 'synchronized']);
    const ASG = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=']);
    const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, instanceof: 7, '<<': 8, '>>': 8, '>>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
    // имя типа: пакеты (с маленькой буквы) отбрасываем — java.util.List → List, net.minecraft.block.Block → Block, Map.Entry остаётся
    const normQ = parts => { let i = 0; while (i < parts.length - 1 && /^[a-z_$][\w$]*$/.test(parts[i])) i++; return parts.slice(i).join('.'); };

    function parse(T){
      let p = 0;
      const pk = (o = 0) => T[Math.min(p + o, T.length - 1)];
      const nx = () => T[p++];
      const is = (v, o = 0) => { const t = pk(o); return (t.k === 'op' || t.k === 'kw') && t.v === v; };
      const isId = (v, o = 0) => { const t = pk(o); return t.k === 'id' && (v === undefined || t.v === v); };
      const tokText = t => t.k === 'eof' ? 'конец кода' : t.k === 'str' ? '"' + t.v.slice(0, 20) + '"' : t.k === 'chr' ? "'" + t.v + "'" : String(t.v);
      const fail = (msg, t = pk()) => { throw JErr(msg + (t.k === 'eof' ? ', а код закончился' : ', а здесь «' + tokText(t) + '»'), t.line); };
      const eat = v => { if (is(v)) { p++; return true; } return false; };
      const want = (v, msg) => {   // не хватает «;» / «)» в конце строки — ошибка на этой строке, а не на следующей
        if (!is(v)) { const t = pk(), pr = T[p - 1]; if (pr && t.line > pr.line && (v === ';' || v === ')' || v === ']')) throw JErr((msg || 'Ожидалось «' + v + '»') + ' в конце строки', pr.line); fail(msg || 'Ожидалось «' + v + '»'); }
        return nx();
      };
      const name = what => { const t = pk(); if (t.k !== 'id') fail('Ожидалось имя' + (what ? ' ' + what : '')); p++; return t.v; };
      const match = (i, open, close) => { let d = 0; for (let j = i; j < T.length; j++) { const t = T[j]; if (t.k === 'eof') return -1; if (t.k !== 'op') continue; if (open.includes(t.v)) d++; else if (close.includes(t.v)) { d--; if (d === 0) return j; if (d < 0) return -1; } } return -1; };
      const qname = () => { const parts = [name()]; while (is('.') && pk(1).k === 'id') { p++; parts.push(nx().v); } return parts.join('.'); };

      // ── аннотации: @Override, @Mod("id"), @SubscribeEvent, @Environment(EnvType.CLIENT) ──
      function annos(){
        const out = [];
        while (is('@') && !is('interface', 1)) {
          const line = nx().line, nm = qname();
          let args = '', str = null;
          if (is('(')) { const c = match(p, '(', ')'); if (c < 0) fail('Не хватает «)» у аннотации'); for (let j = p + 1; j < c; j++) { args += T[j].v + ' '; if (T[j].k === 'str' && str === null) str = T[j].v; } p = c + 1; }
          out.push({ name: nm.split('.').pop(), full: nm, args: args.trim(), str, line });
        }
        return out;
      }
      function modifiers(){
        const mods = new Set();
        for (;;) {
          const t = pk();
          if (t.k === 'kw' && MODS.has(t.v) && !(t.v === 'default' && (is(':', 1) || is('->', 1)))) { mods.add(nx().v); continue; }
          if (t.k === 'id' && t.v === 'sealed' && (pk(1).k === 'kw' || pk(1).k === 'id')) { p++; mods.add('sealed'); continue; }
          if (t.k === 'id' && t.v === 'non' && is('-', 1) && isId('sealed', 2)) { p += 3; mods.add('non-sealed'); continue; }
          if (t.k === 'op' && t.v === '@' && !is('interface', 1)) { annos(); continue; }
          break;
        }
        return mods;
      }

      // ── типы: int, String[], List<Integer>, Map<String, List<Integer>>, ? extends T, java.util.List<T>, Map.Entry<K, V> ──
      function type(o = {}){
        const s = p;
        while (is('@') && !is('interface', 1)) annos();
        let t = baseType(o);
        if (t === null) { p = s; return null; }
        while (is('[') && is(']', 1)) { p += 2; t += '[]'; }
        if (o.va && is('...')) { p++; t += '[]'; o.isVa = true; }
        return t;
      }
      function baseType(o){
        const t = pk();
        if (t.k === 'kw' && (PRIMS.has(t.v) || t.v === 'void')) { p++; return t.v; }
        if (t.k === 'op' && t.v === '?' && o.wild) {
          p++;
          if (is('extends') || is('super')) { p++; const b = type(); return b || 'Object'; }
          return 'Object';
        }
        if (t.k !== 'id') return null;
        const parts = [];
        for (;;) {
          const id = pk(); if (id.k !== 'id') return null;
          p++;
          let seg = id.v;
          if (is('<')) { const a = typeArgs(); if (a === null) return null; seg += '<' + a.join(',') + '>'; }
          parts.push(seg);
          if (is('.') && pk(1).k === 'id') { p++; continue; }
          if (is('.') && is('@', 1)) { p++; annos(); continue; }
          break;
        }
        return normQ(parts);
      }
      function typeArgs(){   // < T, U > — null, если это не аргументы типа
        const s = p; p++;
        if (is('>')) { p++; return ['']; }   // <> — «ромб»
        const a = [];
        for (;;) { const t = type({ wild: true }); if (!t) { p = s; return null; } a.push(t); if (eat(',')) continue; if (eat('>')) return a; p = s; return null; }
      }
      function typeOrFail(what){ const t = type(); if (!t) fail('Ожидался тип' + (what ? ' ' + what : '')); return t; }
      function typeParams(){   // <T extends Comparable<T> & Serializable, U>
        want('<'); const out = [];
        do { annos(); const nm = name('параметра типа'); let bound = null; if (eat('extends')) { bound = typeOrFail(); while (eat('&')) typeOrFail(); } out.push({ name: nm, bound }); } while (eat(','));
        want('>');
        return out;
      }

      // ── единица компиляции: package, import, типы, а ещё методы, поля и инструкции верхнего уровня (как JShell / Java 25) ──
      function unit(){
        const U = { pkg: null, imports: [], types: [], items: [] };
        while (pk().k !== 'eof') {
          if (eat(';')) continue;
          if (is('package')) { p++; U.pkg = qname(); want(';'); continue; }   // можно и в середине: склеенные файлы
          if (is('import')) {
            const line = nx().line, st = eat('static');
            const parts = [name()]; let star = false;
            while (eat('.')) { if (eat('*')) { star = true; break; } parts.push(name()); }
            want(';', 'Ожидалось «;» после import');
            U.imports.push({ name: parts.join('.'), last: parts[parts.length - 1], st, star, line });
            continue;
          }
          if (isId('module') && pk(1).k === 'id') throw JErr('Модули Java (module-info) не нужны — убери этот файл', pk().line);
          if (typeAhead()) { U.types.push(typeDecl()); continue; }
          const m = topMember(); if (m) { U.items.push(m); continue; }
          U.items.push(stmt());
        }
        return U;
      }
      function typeAhead(){   // после аннотаций и модификаторов — class / interface / enum / record / @interface?
        let o = 0;
        for (;;) {
          const t = pk(o);
          if (t.k === 'op' && t.v === '@') {
            if (pk(o + 1).k === 'kw' && pk(o + 1).v === 'interface') return true;
            o++; while (pk(o).k === 'id' && pk(o + 1).k === 'op' && pk(o + 1).v === '.') o += 2;
            if (pk(o).k === 'id') o++;
            if (pk(o).k === 'op' && pk(o).v === '(') { const c = match(p + o, '(', ')'); if (c < 0) return false; o = c - p + 1; }
            continue;
          }
          if (t.k === 'kw' && MODS.has(t.v) && t.v !== 'default') { o++; continue; }
          if (t.k === 'id' && (t.v === 'sealed' || t.v === 'non') && (pk(o + 1).k === 'kw' || pk(o + 1).k === 'id' || (pk(o + 1).k === 'op' && pk(o + 1).v === '-'))) { o += t.v === 'non' ? 3 : 1; continue; }
          if (t.k === 'kw' && (t.v === 'class' || t.v === 'interface' || t.v === 'enum')) return pk(o + 1).k === 'id';
          return t.k === 'id' && t.v === 'record' && pk(o + 1).k === 'id' && (pk(o + 2).k === 'op' && (pk(o + 2).v === '(' || pk(o + 2).v === '<'));
        }
      }
      function topMember(){   // метод или поле верхнего уровня; иначе null (это инструкция)
        const s = p, line = pk().line;
        const an = annos(), mods = modifiers();
        let tps = null;
        if (is('<')) { const q = p; try { tps = typeParams(); } catch (e) { p = q; tps = null; } }
        const ty = type();
        if (ty && pk().k === 'id') {
          if (is('(', 1)) { const nm = nx().v; return methodRest(ty, nm, mods, an, tps, line, true); }
          if (!tps && (is('=', 1) || is(';', 1) || is(',', 1) || (is('[', 1) && is(']', 2)))) { const nm = nx().v; const f = fieldRest(ty, nm, mods, an, line); f.top = true; return f; }
        }
        if (mods.size || an.length || tps) { p = s; if (mods.size && !ty) fail('Ожидалось объявление'); }
        p = s; return null;
      }
      function typeDecl(){
        const an = annos(), mods = modifiers();
        const t = pk(), line = t.line;
        if (t.k === 'op' && t.v === '@') {   // @interface — объявление аннотации: пропускаем целиком
          p += 2; const nm = name('аннотации'); want('{'); const c = match(p - 1, '{', '}'); if (c < 0) fail('Не хватает «}»'); p = c + 1;
          return { kind: 'anno', name: nm, line, end: T[c].line, mods, annos: an, members: [], impl: [], tps: null };
        }
        p++;
        const kind = t.v === 'record' ? 'record' : t.v;
        const nm = name(kind === 'class' ? 'класса' : kind === 'interface' ? 'интерфейса' : kind === 'enum' ? 'перечисления' : 'записи');
        let tps = null; if (is('<')) tps = typeParams();
        let comps = null;
        if (kind === 'record') { want('('); comps = []; if (!eat(')')) { do { annos(); modifiers(); const cl = pk().line, o = { va: true }, ty = type(o); if (!ty) fail('Ожидался тип компонента записи'); comps.push({ ty, name: name('компонента'), va: !!o.isVa, line: cl }); } while (eat(',')); want(')'); } }
        let ext = null; const impl = [];
        if (eat('extends')) { if (kind === 'interface') { do impl.push(typeOrFail()); while (eat(',')); } else if (kind === 'class') ext = typeOrFail('базового класса'); else fail(kind + ' не может наследовать класс (extends)'); }
        if (eat('implements')) { if (kind === 'interface') fail('Интерфейс расширяет другие через extends'); do impl.push(typeOrFail('интерфейса')); while (eat(',')); }
        if (isId('permits')) { p++; do typeOrFail(); while (eat(',')); }
        want('{', 'Ожидалось «{» — начало ' + nm);
        let consts = null; if (kind === 'enum') consts = enumConsts();
        const members = [];
        while (!is('}')) { if (pk().k === 'eof') fail('Не хватает «}» у ' + nm); const m = member(nm, kind); if (m) members.push(m); }
        const end = nx().line;
        return { kind, name: nm, tps, comps, ext, impl, members, consts, mods, annos: an, line, end };
      }
      function enumConsts(){
        const out = [];
        while (!is(';') && !is('}')) {
          annos();
          const l = pk().line, nm = name('константы enum');
          let args = null; if (is('(')) { p++; args = argList(); }
          let body = null; if (is('{')) body = classBody();
          out.push({ name: nm, args, body, line: l });
          if (!eat(',')) break;
        }
        eat(';');
        return out;
      }
      function classBody(){   // { члены } — тело анонимного класса или константы enum
        const line = want('{').line, members = [];
        while (!is('}')) { if (pk().k === 'eof') fail('Не хватает «}»'); const m = member('', 'class'); if (m) members.push(m); }
        return { members, line, end: nx().line };
      }
      function member(cname, kind){
        const line = pk().line;
        if (eat(';')) return null;
        if (is('{')) return { m: 'init', st: false, body: block(), line };
        if (is('static') && is('{', 1)) { p++; return { m: 'init', st: true, body: block(), line }; }
        const s0 = p;
        const an = annos(), mods = modifiers();
        if (typeAhead()) { p = s0; return { m: 'type', decl: typeDecl(), line }; }
        let tps = null; if (is('<')) tps = typeParams();
        if (cname && isId(cname) && is('(', 1)) {   // конструктор
          p += 2; const ps = params(); throwsList();
          const body = block();
          return { m: 'ctor', params: ps, body, mods, annos: an, line, end: body.end };
        }
        if (kind === 'record' && cname && isId(cname) && is('{', 1)) { p++; const body = block(); return { m: 'cctor', body, mods, annos: an, line, end: body.end }; }
        if (pk().k === 'id' && is('(', 1) && !PRIMS.has(pk().v)) fail('Метод без типа результата: напиши void или тип (int, String…). Если это конструктор — имя должно совпадать с классом ' + cname);
        const ty = type();
        if (!ty) fail('Ожидалось объявление поля или метода');
        const nm = name('поля или метода');
        if (is('(')) return methodRest(ty, nm, mods, an, tps, line, false, kind);
        return fieldRest(ty, nm, mods, an, line);
      }
      function methodRest(ty, nm, mods, an, tps, line, top, kind){
        want('('); const ps = params();
        let rt = ty; while (is('[') && is(']', 1)) { p += 2; rt += '[]'; }
        throwsList();
        let body = null;
        if (is('{')) body = block();
        else if (isId('default')) { while (!is(';') && pk().k !== 'eof') p++; want(';'); }
        else want(';', 'Ожидалось тело метода { … } (или «;» у абстрактного)');
        return { m: 'method', name: nm, ret: rt, params: ps, body, mods, annos: an, tps, line, end: body ? body.end : line, top: !!top };
      }
      function fieldRest(ty, first, mods, an, line){
        const decls = [];
        let nm = first;
        for (;;) {
          const nl = T[p - 1].line;
          let t2 = ty; while (is('[') && is(']', 1)) { p += 2; t2 += '[]'; }
          let init = null; if (eat('=')) init = is('{') ? arrInit() : expr();
          decls.push({ name: nm, ty: t2, init, line: nl });
          if (!eat(',')) break;
          nm = name('поля');
        }
        want(';', 'Ожидалось «;» после объявления');
        return { m: 'field', ty, decls, mods, annos: an, line };
      }
      function throwsList(){ if (eat('throws')) do typeOrFail(); while (eat(',')); }
      function params(){
        const ps = [];
        if (eat(')')) return ps;
        do {
          const an = annos(); modifiers();
          const pl = pk().line, o = { va: true }, ty = type(o);
          if (!ty) fail('Ожидался тип параметра');
          if (is('this')) { p++; continue; }   // receiver parameter: Foo this
          const nm = name('параметра');
          let t2 = ty; while (is('[') && is(']', 1)) { p += 2; t2 += '[]'; }
          ps.push({ name: nm, ty: t2, va: !!o.isVa, line: pl, annos: an });
        } while (eat(','));
        want(')');
        for (let i = 0; i < ps.length - 1; i++) if (ps[i].va) throw JErr('Параметр с ... (varargs) — только последним', ps[i].line);
        return ps;
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
        if (t.k === 'id' && is(':', 1)) { p += 2; return { s: 'label', label: t.v, body: stmt(), line }; }
        if (t.k === 'kw') switch (t.v) {
          case 'if': { p++; want('('); const c = expr(); want(')'); const a = stmt(); let b = null; if (eat('else')) b = stmt(); return { s: 'if', c, a, b, line }; }
          case 'while': { p++; want('('); const c = expr(); want(')'); return { s: 'while', c, body: stmt(), line }; }
          case 'do': { p++; const body = stmt(); want('while', 'Ожидалось «while» после тела do'); want('('); const c = expr(); want(')'); want(';'); return { s: 'do', body, c, line }; }
          case 'for': return forStmt();
          case 'switch': { const sw = switchBody(); return Object.assign({ s: 'switch' }, sw, { line }); }
          case 'break': { p++; const lab = pk().k === 'id' ? nx().v : null; want(';'); return { s: 'break', label: lab, line }; }
          case 'continue': { p++; const lab = pk().k === 'id' ? nx().v : null; want(';'); return { s: 'continue', label: lab, line }; }
          case 'return': { p++; const e = is(';') ? null : expr(); want(';'); return { s: 'return', e, line }; }
          case 'throw': { p++; const e = expr(); want(';'); return { s: 'throw', e, line }; }
          case 'try': return tryStmt();
          case 'assert': { p++; const c = expr(); let m = null; if (eat(':')) m = expr(); want(';'); return { s: 'assert', c, m, line }; }
          case 'synchronized': throw JErr('synchronized не поддерживается: скрипты идут в одном потоке — просто убери synchronized', line);
          case 'goto': case 'const': throw JErr(t.v + ' в Java не используется', line);
          case 'this': case 'super':
            if (is('(', 1)) { p += 2; const args = argList(); want(';'); return { s: 'ctorcall', kind: t.v, args, line }; }
            break;
        }
        if (isId('yield') && !is('=', 1) && !is('.', 1) && !is('[', 1) && !is('++', 1) && !is('--', 1) && !(pk(1).k === 'op' && ASG.has(pk(1).v)) && !is(';', 1)) {
          p++; const e = expr(); want(';'); return { s: 'yield', e, line };
        }
        if (typeAhead()) return { s: 'ltype', decl: typeDecl(), line };
        const d = localDecl(true); if (d) return d;
        const e = expr();
        want(';', 'Ожидалось «;» в конце инструкции');
        return { s: 'expr', e, line };
      }
      function localDecl(semi){
        const s = p, line = pk().line;
        let fin = false;
        for (;;) { if (is('final')) { p++; fin = true; continue; } if (is('@') && !is('interface', 1)) { annos(); continue; } break; }
        const ty = type();
        if (ty && pk().k === 'id' && (is('=', 1) || is(';', 1) || is(',', 1) || (is('[', 1) && is(']', 2)) || (!semi && is(':', 1)))) {
          if (!semi && is(':', 1)) { p = s; return null; }
          const decls = [];
          do {
            const nl = pk().line, nm = name('переменной');
            let t2 = ty; while (is('[') && is(']', 1)) { p += 2; t2 += '[]'; }
            let init = null; if (eat('=')) init = is('{') ? arrInit() : expr();
            decls.push({ name: nm, ty: t2, init, line: nl });
          } while (eat(','));
          if (semi) want(';', 'Ожидалось «;» после объявления');
          return { s: 'var', ty, decls, fin, line };
        }
        if (fin) fail('Ожидалось объявление переменной после final');
        p = s; return null;
      }
      function forStmt(){
        const line = nx().line; want('(');
        { // for (Тип x : коллекция)
          const s = p;
          for (;;) { if (is('final')) { p++; continue; } if (is('@') && !is('interface', 1)) { annos(); continue; } break; }
          const ty = type();
          if (ty && pk().k === 'id' && is(':', 1)) { const nm = nx().v; p++; const coll = expr(); want(')'); return { s: 'foreach', ty, name: nm, coll, body: stmt(), line }; }
          p = s;
        }
        let init = null;
        if (!is(';')) { const d = localDecl(false); if (d) init = d; else { const es = []; do es.push(expr()); while (eat(',')); init = es; } }
        want(';', 'Ожидалось «;» в for (…; …; …)');
        const c = is(';') ? null : expr();
        want(';', 'Ожидалось «;» в for (…; …; …)');
        const upd = [];
        if (!is(')')) do upd.push(expr()); while (eat(','));
        want(')');
        return { s: 'for', init, c, upd, body: stmt(), line };
      }
      function caseLabel(){   // null | default | Тип имя | Запись(…) | константа
        const line = pk().line;
        if (is('null')) { p++; return { p: 'null', line }; }
        if (is('default')) { p++; return { p: 'default', line }; }
        const s = p;
        while (is('final')) p++;
        const ty = type();
        if (ty) {
          if (pk().k === 'id' && !isId('when')) return { p: 'type', ty, name: nx().v, line };
          if (is('(') && /^[A-Z]/.test(ty.split('.').pop())) return recPattern(ty, line);
        }
        p = s;
        return { p: 'const', e: condX(), line };
      }
      function recPattern(ty, line){   // Point(int x, var y) [p]
        want('(');
        const subs = [];
        if (!eat(')')) {
          do {
            const sl = pk().line, s = p, t2 = type();
            if (t2 && is('(')) subs.push(recPattern(t2, sl));
            else if (t2 && pk().k === 'id') subs.push({ p: 'type', ty: t2 === 'var' ? null : t2, name: nx().v, line: sl });
            else { p = s; fail('Ожидался шаблон: Тип имя'); }
          } while (eat(','));
          want(')');
        }
        let nm = null; if (pk().k === 'id' && !isId('when')) nm = nx().v;
        return { p: 'rec', ty, subs, name: nm, line };
      }
      function switchBody(){
        const line = nx().line; want('('); const e = expr(); want(')'); want('{');
        const cases = []; let arrow = null;
        while (!eat('}')) {
          const cl = pk().line;
          const labels = []; let guard = null;
          if (is('default')) { p++; labels.push({ p: 'default', line: cl }); }
          else if (is('case')) { p++; do labels.push(caseLabel()); while (eat(',')); if (isId('when')) { p++; guard = expr(); } }
          else fail('Ожидалось case или default');
          let a;
          if (is('->')) { p++; a = true; } else { want(':', 'Ожидалось «:» или «->» после case'); a = false; }
          if (arrow === null) arrow = a; else if (arrow !== a) throw JErr('В одном switch нельзя смешивать «case …:» и «case … ->»', cl);
          let body;
          if (a) {
            if (is('{')) body = { kind: 'block', b: block() };
            else if (is('throw')) { const tl = pk().line; p++; const te = expr(); want(';'); body = { kind: 'throw', e: te, line: tl }; }
            else { const bl = pk().line, ex = expr(); want(';'); body = { kind: 'expr', e: ex, line: bl }; }
          } else {
            const list = [];
            while (!is('case') && !is('default') && !is('}')) { if (pk().k === 'eof') fail('Не хватает «}» у switch'); list.push(stmt()); }
            body = { kind: 'stmts', list };
          }
          cases.push({ labels, guard, body, line: cl });
        }
        return { e, cases, arrow: !!arrow, line };
      }
      function tryStmt(){
        const line = nx().line;
        let res = null;
        if (eat('(')) {
          res = [];
          while (!is(')')) {
            const rl = pk().line, s = p;
            for (;;) { if (is('final')) { p++; continue; } if (is('@')) { annos(); continue; } break; }
            const ty = type();
            if (ty && pk().k === 'id' && is('=', 1)) { const nm = nx().v; p++; res.push({ ty, name: nm, init: expr(), line: rl }); }
            else { p = s; res.push({ e: expr(), line: rl }); }
            if (!eat(';')) break;
          }
          want(')');
        }
        const body = block(), catches = [];
        let fin = null;
        while (is('catch')) {
          const cl = nx().line; want('(');
          for (;;) { if (is('final')) { p++; continue; } if (is('@')) { annos(); continue; } break; }
          const types = [typeOrFail('исключения')];
          while (eat('|')) types.push(typeOrFail('исключения'));
          const nm = name('переменной исключения'); want(')');
          catches.push({ types, name: nm, body: block(), line: cl });
        }
        if (eat('finally')) fin = block();
        if (!catches.length && !fin && !res) fail('После try нужен catch или finally');
        return { s: 'try', res, body, catches, fin, line };
      }

      // ── выражения (приоритеты как в Java) ──
      function expr(){
        if (lambdaAhead()) return lambda();
        const line = pk().line, l = condX(), op = asgOp();
        if (op) { p += op[1]; return { k: 'asg', op: op[0], l, r: expr(), line }; }
        return l;
      }
      function binOpAt(){   // текущий бинарный оператор; > > → >>, > > > → >>>, > >= → >>=, > > >= → >>>=
        const t = pk();
        if (t.k === 'kw' && t.v === 'instanceof') return ['instanceof', 1];
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
        if (is('?')) { p++; const a = lambdaAhead() ? lambda() : expr(); want(':', 'Ожидалось «:» в выражении усл ? a : b'); const b = lambdaAhead() ? lambda() : condX(); return { k: 'cond', c, a, b, line }; }
        return c;
      }
      function bin(min){
        let l = unary();
        for (;;) {
          const b = binOpAt(); if (!b) break;
          const [op, len] = b, pr = PREC[op];
          if (pr === undefined || pr < min) break;
          const line = pk().line;
          if (op === 'instanceof') {
            p++; while (is('final')) p++;
            const ty = typeOrFail('после instanceof');
            if (is('(')) { l = { k: 'inst', e: l, pat: recPattern(ty, line), line }; continue; }
            let nm = null; if (pk().k === 'id') nm = nx().v;
            l = { k: 'inst', e: l, ty, name: nm, line };
            continue;
          }
          p += len;
          l = { k: 'bin', op, l, r: bin(pr + 1), line };
        }
        return l;
      }
      const startsUnary = t => t.k === 'id' || t.k === 'num' || t.k === 'str' || t.k === 'chr' ||
        (t.k === 'op' && ['(', '!', '~', '-', '+', '++', '--'].includes(t.v)) || (t.k === 'kw' && (['this', 'super', 'new', 'true', 'false', 'null', 'switch'].includes(t.v) || PRIMS.has(t.v)));
      function unary(){
        const t = pk(), line = t.line;
        if (t.k === 'op') {
          if (t.v === '-' && pk(1).k === 'num' && pk(1).big) { p += 2; const u = T[p - 1]; return { k: 'num', v: u.nt === 'long' ? -u.v : -I32, nt: u.nt, line }; }
          if (['+', '-', '!', '~', '++', '--'].includes(t.v)) { p++; return { k: 'un', op: t.v, e: unary(), line }; }
          if (t.v === '(') { const c = tryCast(); if (c) return c; }
        }
        if (t.k === 'num' && t.big) throw JErr(t.nt === 'long' ? 'Число 9223372036854775808L больше long (можно только -9223372036854775808L)' : 'Число 2147483648 больше int — добавь L (long) или минус', line);
        return postfix(primary());
      }
      function tryCast(){   // (int) x, (double) (a + b), (String) obj, (Runnable) () -> …
        const s = p, line = pk().line;
        p++;
        const t0 = pk();
        const prim = t0.k === 'kw' && PRIMS.has(t0.v);
        const ty = type();
        if (!ty || ty === 'void') { p = s; return null; }
        while (eat('&')) { if (!type()) { p = s; return null; } }   // (A & B) — пересечение: берём первый
        if (!is(')')) { p = s; return null; }
        p++;
        const nt = pk();
        let ok;
        if (prim && !/\[\]$/.test(ty)) ok = startsUnary(nt);
        else ok = nt.k === 'id' || nt.k === 'num' || nt.k === 'str' || nt.k === 'chr' || (nt.k === 'op' && (nt.v === '(' || nt.v === '!' || nt.v === '~')) ||
          (nt.k === 'kw' && (['this', 'super', 'new', 'true', 'false', 'null', 'switch'].includes(nt.v) || PRIMS.has(nt.v)));
        if (!ok) { p = s; return null; }
        if (lambdaAhead()) return { k: 'cast', ty, e: lambda(), line };
        return { k: 'cast', ty, e: unary(), line };
      }
      function primary(){
        const t = pk(), line = t.line;
        switch (t.k) {
          case 'num': p++; return { k: 'num', v: t.v, nt: t.nt, line };
          case 'str': p++; return { k: 'str', v: t.v, line };
          case 'chr': p++; return { k: 'chr', v: t.v, line };
          case 'id': return idX();
          case 'op':
            if (t.v === '(') { p++; const e = expr(); want(')'); return Object.assign({}, e, { paren: true }); }
            if (t.v === '@') { annos(); return primary(); }
            break;
          case 'kw':
            switch (t.v) {
              case 'true': case 'false': p++; return { k: 'bool', v: t.v === 'true', line };
              case 'null': p++; return { k: 'null', line };
              case 'this': p++; return { k: 'this', line };
              case 'super': p++; return { k: 'super', line };
              case 'new': return newX(null);
              case 'switch': { const sw = switchBody(); return Object.assign({ k: 'swx' }, sw, { line }); }
              case 'void': if (is('.', 1) && is('class', 2)) { p += 3; return { k: 'clslit', ty: 'void', line }; } break;
              default:
                if (PRIMS.has(t.v)) {
                  const ty = type();
                  if (is('.') && is('class', 1)) { p += 2; return { k: 'clslit', ty, line }; }
                  if (is('::')) return { k: 'tyexpr', ty, line };
                  fail('Ожидалось выражение (тип ' + ty + ' здесь не к месту)', t);
                }
            }
        }
        fail(t.k === 'eof' ? 'Не хватает выражения' : 'Ожидалось выражение');
      }
      function idX(){
        const t = pk(), line = t.line;
        if (is('[', 1) && is(']', 2)) {   // String[]::new, int[][].class
          const s = p, ty = type();
          if (ty && is('::')) return { k: 'tyexpr', ty, line };
          if (ty && is('.') && is('class', 1)) { p += 2; return { k: 'clslit', ty, line }; }
          p = s;
        }
        if (is('<', 1)) {   // List<String>::new / Map<K,V>::get
          const s = p, ty = type();
          if (ty && is('::')) return { k: 'tyexpr', ty, line };
          p = s;
        }
        p++;
        return { k: 'id', name: t.v, line };
      }
      function postfix(e){
        for (;;) {
          const t = pk(), line = t.line;
          if (t.k !== 'op') break;
          if (t.v === '.') {
            p++;
            if (is('new')) { e = newX(e); continue; }
            if (is('class')) { p++; e = { k: 'clslit', ty: exprType(e), line }; continue; }
            if (is('this')) { p++; e = { k: 'othis', ty: exprType(e), line }; continue; }
            if (is('super')) { p++; e = { k: 'isuper', ty: exprType(e), line }; continue; }
            let targs = null; if (is('<')) { targs = typeArgs(); if (!targs) fail('Ожидались аргументы типа <…>'); }
            const nt = nx();
            if (nt.k !== 'id') fail('Ожидалось имя после «.»', nt);
            e = { k: 'mem', o: e, name: nt.v, targs, line };
            continue;
          }
          if (t.v === '(') { p++; e = { k: 'call', f: e, args: argList(), line }; continue; }
          if (t.v === '[') { p++; const i = expr(); want(']'); e = { k: 'idx', o: e, i, line }; continue; }
          if (t.v === '++' || t.v === '--') { p++; e = { k: 'post', op: t.v, e, line }; continue; }
          if (t.v === '::') { p++; if (is('<')) typeArgs(); const nm = is('new') ? (p++, 'new') : name('метода'); e = { k: 'mref', o: e, name: nm, line }; continue; }
          break;
        }
        return e;
      }
      function exprType(e){   // a.b.C (выражение из имён) → строка типа
        if (e.k === 'id') return e.name;
        if (e.k === 'mem' && !e.targs) { const b = exprType(e.o); return b ? normQ(b.split('.').concat([e.name])) : null; }
        if (e.k === 'tyexpr') return e.ty;
        throw JErr('Здесь нужен тип', e.line);
      }
      function newX(outer){
        const line = nx().line;
        if (is('<')) typeArgs();
        annos();
        const t0 = pk();
        let ty;
        if (t0.k === 'kw' && PRIMS.has(t0.v)) { p++; ty = t0.v; }
        else { ty = baseType({}); if (!ty) fail('Ожидался тип после new'); }
        if (is('[')) {
          const dims = []; let extra = 0;
          while (is('[')) {
            if (is(']', 1)) { p += 2; extra++; continue; }
            if (extra) fail('Размеры массива пишутся слева: new int[3][]');
            p++; dims.push(expr()); want(']');
          }
          let init = null;
          if (is('{')) { if (dims.length) fail('Либо размер new int[3], либо список new int[] { … }'); init = arrInit(); }
          else if (!dims.length) fail('Нужен размер массива [n] или список { … }');
          return { k: 'newarr', ty, dims, extra, init, line };
        }
        if (!is('(')) fail('Ожидалось ( после new ' + ty);
        p++;
        const args = argList();
        let body = null; if (is('{')) body = classBody();
        return { k: 'new', ty, args, body, outer, line };
      }
      function argList(){
        const args = [];
        if (eat(')')) return args;
        do args.push(expr()); while (eat(','));
        want(')', 'Ожидалось «)» или «,» между аргументами');
        return args;
      }
      function arrInit(){   // { 1, 2, { 3, 4 }, }
        const line = want('{').line, items = [];
        while (!is('}')) { items.push(is('{') ? arrInit() : expr()); if (!eat(',')) break; }
        want('}');
        return { k: 'arrinit', items, line };
      }
      function lambdaAhead(){
        const t = pk();
        if (t.k === 'id' && is('->', 1)) return true;
        if (t.k === 'op' && t.v === '(') { const c = match(p, '(', ')'); return c > 0 && T[c + 1] && T[c + 1].k === 'op' && T[c + 1].v === '->'; }
        return false;
      }
      function lambda(){
        const line = pk().line, ps = [];
        if (pk().k === 'id') ps.push({ name: nx().v, ty: null });
        else {
          want('(');
          if (!eat(')')) {
            do {
              for (;;) { if (is('final')) { p++; continue; } if (is('@')) { annos(); continue; } break; }
              if (pk().k === 'id' && (is(',', 1) || is(')', 1))) ps.push({ name: nx().v, ty: null });
              else { const ty = type({ va: true }); if (!ty) fail('Ожидался параметр лямбды'); ps.push({ name: name('параметра'), ty: ty === 'var' ? null : ty }); }
            } while (eat(','));
            want(')');
          }
        }
        want('->');
        return { k: 'lambda', params: ps, body: is('{') ? block() : expr(), line };
      }
      return { unit, exprOnly(){ const e = expr(); if (pk().k !== 'eof') fail('Лишнее в выражении'); return e; } };
    }
    // ═══ 3. Типы — строки Java: 'int' 'double' 'String' 'List<Integer>' 'int[]' 'Map<String,List<Integer>>' (null — неизвестно) ═══
    const splitTop = s => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '<') d++; else if (c === '>') d--; if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c; } if (cur !== '' || out.length) out.push(cur); return out; };
    const genName = t => (t || '').replace(/<.*$/, '');
    const genArgs = t => { const m = /^[^<]*<(.*)>(\[\])*$/.exec(t || ''); return m && !/\[\]$/.test(t) ? splitTop(m[1]).filter(x => x !== '') : []; };
    const isArrT = t => /\[\]$/.test(t || '');
    const arrElem = t => t.slice(0, -2);
    const BOX = { int: 'Integer', long: 'Long', short: 'Short', byte: 'Byte', char: 'Character', float: 'Float', double: 'Double', boolean: 'Boolean' };
    const UNBOX = { Integer: 'int', Long: 'long', Short: 'short', Byte: 'byte', Character: 'char', Float: 'float', Double: 'double', Boolean: 'boolean' };
    const NUMS = new Set(['int', 'long', 'short', 'byte', 'char', 'float', 'double']);
    const prim = t => UNBOX[t] || t;
    const boxed = t => BOX[t] || t;
    const isIntegral = t => { t = prim(t); return t === 'int' || t === 'short' || t === 'byte' || t === 'char' || t === 'long'; };
    const isNum = t => NUMS.has(prim(t));
    const isInt32 = t => { t = prim(t); return t === 'int' || t === 'short' || t === 'byte'; };   // char — строка, у неё своё
    const isLong = t => prim(t) === 'long';
    const isFloatT = t => { t = prim(t); return t === 'float' || t === 'double'; };
    // двоичное числовое продвижение: double > float > long > int (char, short, byte → int)
    const promo = (a, b) => { a = prim(a); b = prim(b); if (a === 'double' || b === 'double') return 'double'; if (a === 'float' || b === 'float') return 'float'; if (a === 'long' || b === 'long') return 'long'; return 'int'; };
    const subst = (t, map) => !t || !map ? t : t.replace(/\b[A-Za-z_$][\w$]*\b/g, m => Object.prototype.hasOwnProperty.call(map, m) && map[m] ? map[m] : m);
    const isTypeVar = (t, tps) => !!t && !!tps && tps.includes(t);

    // ═══ 4. Библиотека Java (то, что есть в песочнице) — для типов: результат метода, параметры лямбд, выбор перегрузки ═══
    // Строка: '[I:]Имя<T> : Предки | член; член…'. Член: имя(Т1,Т2):Р | static имя(…):Р | static ПОЛЕ:Т | поле:Т | new(…) | *имя(…):Р
    // (* — метод функционального интерфейса); «=имя» в конце — другое имя метода в JS (List.remove(int) → removeAt).
    // Однобуквенные заглавные (T, R, K, V, E, U, A) — параметры типа; если их нет в заголовке — параметры метода.
    const EXC_LIST = [['Throwable', 'Object'], ['Exception', 'Throwable'], ['Error', 'Throwable'], ['RuntimeException', 'Exception'], ['ArithmeticException', 'RuntimeException'],
      ['NullPointerException', 'RuntimeException'], ['ClassCastException', 'RuntimeException'], ['IllegalArgumentException', 'RuntimeException'], ['IllegalStateException', 'RuntimeException'],
      ['NumberFormatException', 'IllegalArgumentException'], ['IndexOutOfBoundsException', 'RuntimeException'], ['ArrayIndexOutOfBoundsException', 'IndexOutOfBoundsException'],
      ['StringIndexOutOfBoundsException', 'IndexOutOfBoundsException'], ['UnsupportedOperationException', 'RuntimeException'], ['NoSuchElementException', 'RuntimeException'],
      ['InputMismatchException', 'NoSuchElementException'], ['ConcurrentModificationException', 'RuntimeException'], ['NegativeArraySizeException', 'RuntimeException'],
      ['ArrayStoreException', 'RuntimeException'], ['InterruptedException', 'Exception'], ['CloneNotSupportedException', 'Exception'], ['IOException', 'Exception'],
      ['UncheckedIOException', 'RuntimeException'], ['TimeoutException', 'Exception'], ['StackOverflowError', 'Error'], ['OutOfMemoryError', 'Error'], ['AssertionError', 'Error'],
      ['DateTimeException', 'RuntimeException'], ['EmptyStackException', 'RuntimeException']];
    const LIBSRC = [
      'Object | equals(Object):boolean; hashCode():int; toString():String; getClass():Class; new()',
      'Class<T> | getSimpleName():String; getName():String; isInstance(Object):boolean; toString():String',
      'Enum<E> : Comparable<E> | name():String; ordinal():int; compareTo(E):int; toString():String; equals(Object):boolean; hashCode():int; getDeclaringClass():Class',
      'Record | equals(Object):boolean; hashCode():int; toString():String',
      'I:Comparable<T> | *compareTo(T):int',
      'I:CharSequence | length():int; charAt(int):char; isEmpty():boolean; toString():String',
      'String : CharSequence, Comparable<String> | length():int; charAt(int):char; isEmpty():boolean; isBlank():boolean; substring(int):String; substring(int,int):String; ' +
        'indexOf(Object):int; indexOf(Object,int):int; lastIndexOf(Object):int; lastIndexOf(Object,int):int; contains(CharSequence):boolean; startsWith(String):boolean; ' +
        'startsWith(String,int):boolean; endsWith(String):boolean; equals(Object):boolean; equalsIgnoreCase(String):boolean; compareTo(String):int; compareToIgnoreCase(String):int; ' +
        'toUpperCase():String; toLowerCase():String; trim():String; strip():String; stripLeading():String; stripTrailing():String; replace(Object,Object):String; ' +
        'replaceAll(String,String):String; replaceFirst(String,String):String; split(String):String[]; split(String,int):String[]; toCharArray():char[]; chars():IntStream; ' +
        'matches(String):boolean; repeat(int):String; concat(String):String; hashCode():int; toString():String; lines():Stream<String>; codePointAt(int):int; ' +
        'formatted(Object...):String; intern():String; subSequence(int,int):String; contentEquals(CharSequence):boolean; indent(int):String; ' +
        'static valueOf(Object):String; static valueOf(char[],int,int):String; static format(String,Object...):String; static join(CharSequence,Object...):String; static copyValueOf(char[]):String; ' +
        'static CASE_INSENSITIVE_ORDER:Comparator<String>; new(); new(Object); new(char[],int,int)',
      'StringBuilder : CharSequence, Comparable<StringBuilder> | append(Object):StringBuilder; append(char[],int,int):StringBuilder; insert(int,Object):StringBuilder; reverse():StringBuilder; toString():String; length():int; ' +
        'charAt(int):char; setCharAt(int,char):void; deleteCharAt(int):StringBuilder; delete(int,int):StringBuilder; replace(int,int,String):StringBuilder; ' +
        'indexOf(String):int; indexOf(String,int):int; lastIndexOf(String):int; setLength(int):void; isEmpty():boolean; substring(int):String; substring(int,int):String; ' +
        'chars():IntStream; capacity():int; compareTo(StringBuilder):int; new(); new(Object)',
      'StringBuffer : StringBuilder | new(); new(Object)',
      'StringJoiner | add(CharSequence):StringJoiner; toString():String; length():int; setEmptyValue(CharSequence):StringJoiner; new(CharSequence); new(CharSequence,CharSequence,CharSequence)',
      'Number | intValue():int; longValue():long; doubleValue():double; floatValue():float; shortValue():short; byteValue():byte',
      'Integer : Number, Comparable<Integer> | compareTo(Integer):int; equals(Object):boolean; hashCode():int; toString():String; ' +
        'static MAX_VALUE:int; static MIN_VALUE:int; static SIZE:int; static BYTES:int; static parseInt(String):int; static parseInt(String,int):int; static valueOf(Object):Integer; static valueOf(String,int):Integer; ' +
        'static toString(int):String; static toString(int,int):String; static toBinaryString(int):String; static toHexString(int):String; static toOctalString(int):String; ' +
        'static compare(int,int):int; static max(int,int):int; static min(int,int):int; static sum(int,int):int; static signum(int):int; static bitCount(int):int; ' +
        'static reverse(int):int; static highestOneBit(int):int; static lowestOneBit(int):int; static numberOfLeadingZeros(int):int; static numberOfTrailingZeros(int):int; ' +
        'static hashCode(int):int; static parseUnsignedInt(String):int; static toUnsignedString(int):String; static divideUnsigned(int,int):int; static remainderUnsigned(int,int):int; static decode(String):Integer',
      'Long : Number, Comparable<Long> | compareTo(Long):int; equals(Object):boolean; hashCode():int; toString():String; ' +
        'static MAX_VALUE:long; static MIN_VALUE:long; static SIZE:int; static BYTES:int; static parseLong(String):long; static parseLong(String,int):long; static valueOf(Object):Long; ' +
        'static toString(long):String; static toString(long,int):String; static toBinaryString(long):String; static toHexString(long):String; static toOctalString(long):String; ' +
        'static compare(long,long):int; static max(long,long):long; static min(long,long):long; static sum(long,long):long; static signum(long):int; static bitCount(long):int; ' +
        'static hashCode(long):int; static numberOfTrailingZeros(long):int; static numberOfLeadingZeros(long):int; static abs(long):long',
      'Double : Number, Comparable<Double> | compareTo(Double):int; equals(Object):boolean; hashCode():int; toString():String; isNaN():boolean; isInfinite():boolean; ' +
        'static MAX_VALUE:double; static MIN_VALUE:double; static POSITIVE_INFINITY:double; static NEGATIVE_INFINITY:double; static NaN:double; static MIN_NORMAL:double; ' +
        'static parseDouble(String):double; static valueOf(Object):Double; static toString(double):String; static compare(double,double):int; static isNaN(double):boolean; ' +
        'static isInfinite(double):boolean; static isFinite(double):boolean; static max(double,double):double; static min(double,double):double; static sum(double,double):double; static hashCode(double):int',
      'Float : Number, Comparable<Float> | compareTo(Float):int; equals(Object):boolean; hashCode():int; toString():String; isNaN():boolean; isInfinite():boolean; ' +
        'static MAX_VALUE:float; static MIN_VALUE:float; static POSITIVE_INFINITY:float; static NEGATIVE_INFINITY:float; static NaN:float; ' +
        'static parseFloat(String):float; static valueOf(Object):Float; static toString(float):String; static compare(float,float):int; static isNaN(float):boolean; ' +
        'static isInfinite(float):boolean; static isFinite(float):boolean; static max(float,float):float; static min(float,float):float; static sum(float,float):float',
      'Short : Number, Comparable<Short> | compareTo(Short):int; equals(Object):boolean; toString():String; static MAX_VALUE:short; static MIN_VALUE:short; static parseShort(String):short; static valueOf(Object):Short; static toString(short):String; static compare(short,short):int',
      'Byte : Number, Comparable<Byte> | compareTo(Byte):int; equals(Object):boolean; toString():String; static MAX_VALUE:byte; static MIN_VALUE:byte; static parseByte(String):byte; static valueOf(Object):Byte; static toString(byte):String; static compare(byte,byte):int',
      'Boolean : Comparable<Boolean> | booleanValue():boolean; compareTo(Boolean):int; equals(Object):boolean; hashCode():int; toString():String; static TRUE:Boolean; static FALSE:Boolean; ' +
        'static parseBoolean(String):boolean; static valueOf(Object):Boolean; static toString(boolean):String; static compare(boolean,boolean):int; static logicalAnd(boolean,boolean):boolean; ' +
        'static logicalOr(boolean,boolean):boolean; static logicalXor(boolean,boolean):boolean; static hashCode(boolean):int',
      'Character : Comparable<Character> | charValue():char; compareTo(Character):int; equals(Object):boolean; hashCode():int; toString():String; static MIN_VALUE:char; static MAX_VALUE:char; ' +
        'static isDigit(char):boolean; static isLetter(char):boolean; static isLetterOrDigit(char):boolean; static isAlphabetic(int):boolean; static isUpperCase(char):boolean; ' +
        'static isLowerCase(char):boolean; static isWhitespace(char):boolean; static isSpaceChar(char):boolean; static toUpperCase(char):char; static toLowerCase(char):char; ' +
        'static getNumericValue(char):int; static digit(char,int):int; static forDigit(int,int):char; static valueOf(char):Character; static toString(char):String; ' +
        'static compare(char,char):int; static isDefined(char):boolean; static toChars(int):char[]; static hashCode(char):int; static isEmoji(int):boolean; ' +
        'static isDigit(int):boolean; static isLetter(int):boolean; static isLetterOrDigit(int):boolean; static isUpperCase(int):boolean; static isLowerCase(int):boolean; ' +
        'static isWhitespace(int):boolean; static isSpaceChar(int):boolean; static toUpperCase(int):int; static toLowerCase(int):int; static getNumericValue(int):int; ' +
        'static digit(int,int):int; static toString(int):String; static isValidCodePoint(int):boolean; static isSurrogate(char):boolean; static isHighSurrogate(char):boolean; static isLowSurrogate(char):boolean; static charCount(int):int; static isISOControl(char):boolean; static isJavaIdentifierStart(char):boolean; static isJavaIdentifierPart(char):boolean; static isTitleCase(char):boolean',
      'Math | static PI:double; static E:double; static TAU:double; static abs(Object):Object; static max(Object,Object):Object; static min(Object,Object):Object; static pow(double,double):double; ' +
        'static sqrt(double):double; static cbrt(double):double; static floor(double):double; static ceil(double):double; static round(Object):Object; static rint(double):double; ' +
        'static random():double; static sin(double):double; static cos(double):double; static tan(double):double; static asin(double):double; static acos(double):double; ' +
        'static atan(double):double; static atan2(double,double):double; static sinh(double):double; static cosh(double):double; static tanh(double):double; static toRadians(double):double; ' +
        'static toDegrees(double):double; static exp(double):double; static log(double):double; static log10(double):double; static log1p(double):double; static expm1(double):double; ' +
        'static hypot(double,double):double; static signum(Object):Object; static floorDiv(Object,Object):Object; static floorMod(Object,Object):Object; static ceilDiv(Object,Object):Object; ' +
        'static clamp(Object,Object,Object):Object; static addExact(Object,Object):Object; static subtractExact(Object,Object):Object; static multiplyExact(Object,Object):Object; ' +
        'static negateExact(Object):Object; static incrementExact(Object):Object; static decrementExact(Object):Object; static toIntExact(long):int; static absExact(Object):Object; ' +
        'static ulp(double):double; static fma(double,double,double):double',
      'StrictMath : Math',
      'System | static out:PrintStream; static err:PrintStream; static currentTimeMillis():long; static nanoTime():long; static arraycopy(Object,int,Object,int,int):void; ' +
        'static exit(int):void; static lineSeparator():String; static identityHashCode(Object):int; static getProperty(String):String; static getenv(String):String; static gc():void',
      'PrintStream | println():void; println(Object):void; print(Object):void; printf(String,Object...):PrintStream; format(String,Object...):PrintStream; flush():void',
      'Objects | static equals(Object,Object):boolean; static hash(Object...):int; static hashCode(Object):int; static toString(Object):String; static toString(Object,String):String; ' +
        'static requireNonNull(T):T; static requireNonNull(T,String):T; static isNull(Object):boolean; static nonNull(Object):boolean; static requireNonNullElse(T,T):T; ' +
        'static requireNonNullElseGet(T,Supplier<T>):T; static compare(T,T,Comparator<T>):int; static checkIndex(int,int):int',
      'Thread | static sleep(long):void; static currentThread():Thread; static onSpinWait():void; getName():String; interrupt():void; isInterrupted():boolean',
      'I:Runnable | *run():void',
      'I:Callable<V> | *call():V',
      'I:AutoCloseable | *close():void',
      'I:Closeable : AutoCloseable | *close():void',
      'I:Iterable<T> | iterator():Iterator<T>; forEach(Consumer<T>):void',
      'I:Iterator<E> | hasNext():boolean; next():E; remove():void; forEachRemaining(Consumer<E>):void',
      'I:ListIterator<E> : Iterator<E> | hasPrevious():boolean; previous():E; nextIndex():int; previousIndex():int; set(E):void; add(E):void',
      'I:Collection<E> : Iterable<E> | add(E):boolean; remove(Object):boolean; size():int; isEmpty():boolean; contains(Object):boolean; containsAll(Collection<Object>):boolean; ' +
        'addAll(Collection<E>):boolean; removeAll(Collection<Object>):boolean; retainAll(Collection<Object>):boolean; removeIf(Predicate<E>):boolean; clear():void; ' +
        'stream():Stream<E>; parallelStream():Stream<E>; toArray():Object[]; toArray(Object):E[]; equals(Object):boolean; hashCode():int; toString():String',
      'I:SequencedCollection<E> : Collection<E> | getFirst():E; getLast():E; removeFirst():E; removeLast():E; addFirst(E):void; addLast(E):void; reversed():List<E>',
      'I:List<E> : SequencedCollection<E> | get(int):E; set(int,E):E; add(int,E):void; remove(int):E=removeAt; indexOf(Object):int; lastIndexOf(Object):int; ' +
        'subList(int,int):List<E>; sort(Comparator<E>):void; replaceAll(UnaryOperator<E>):void; listIterator():ListIterator<E>; listIterator(int):ListIterator<E>; addAll(int,Collection<E>):boolean; ' +
        'static of(E...):List<E>; static copyOf(Collection<E>):List<E>',
      'ArrayList<E> : List<E>, RandomAccess | ensureCapacity(int):void; trimToSize():void; clone():Object; new(); new(Object)',
      'Vector<E> : ArrayList<E> | new(); new(Object)',
      'Stack<E> : Vector<E> | push(E):E; pop():E; peek():E; empty():boolean; search(Object):int; new()',
      'I:Queue<E> : Collection<E> | offer(E):boolean; poll():E; peek():E; element():E; remove():E=removeHead',
      'I:Deque<E> : Queue<E>, SequencedCollection<E> | push(E):void; pop():E; offerFirst(E):boolean; offerLast(E):boolean; pollFirst():E; pollLast():E; peekFirst():E; peekLast():E; ' +
        'descendingIterator():Iterator<E>; removeFirstOccurrence(Object):boolean; removeLastOccurrence(Object):boolean',
      'ArrayDeque<E> : Deque<E> | clone():ArrayDeque<E>; new(); new(Object)',
      'LinkedList<E> : List<E>, Deque<E> | new(); new(Collection<E>)',
      'PriorityQueue<E> : Queue<E> | comparator():Comparator<E>; new(); new(Object); new(int,Comparator<E>)',
      'I:Set<E> : Collection<E> | static of(E...):Set<E>; static copyOf(Collection<E>):Set<E>',
      'I:SortedSet<E> : Set<E>, SequencedCollection<E> | first():E; last():E; headSet(E):SortedSet<E>; tailSet(E):SortedSet<E>; subSet(E,E):SortedSet<E>; comparator():Comparator<E>',
      'I:NavigableSet<E> : SortedSet<E> | floor(E):E; ceiling(E):E; higher(E):E; lower(E):E; pollFirst():E; pollLast():E; descendingSet():NavigableSet<E>; descendingIterator():Iterator<E>; ' +
        'headSet(E,boolean):NavigableSet<E>; tailSet(E,boolean):NavigableSet<E>',
      'HashSet<E> : Set<E> | clone():Object; new(); new(Object)',
      'LinkedHashSet<E> : HashSet<E>, SequencedCollection<E> | new(); new(Object)',
      'TreeSet<E> : NavigableSet<E> | new(); new(Object)',
      'I:Map<K,V> | get(Object):V; put(K,V):V; getOrDefault(Object,V):V; containsKey(Object):boolean; containsValue(Object):boolean; remove(Object):V; size():int; ' +
        'isEmpty():boolean; keySet():Set<K>; values():Collection<V>; entrySet():Set<Map.Entry<K,V>>; putAll(Map<K,V>):void; clear():void; putIfAbsent(K,V):V; ' +
        'computeIfAbsent(K,Function<K,V>):V; computeIfPresent(K,BiFunction<K,V,V>):V; compute(K,BiFunction<K,V,V>):V; merge(K,V,BiFunction<V,V,V>):V; ' +
        'forEach(BiConsumer<K,V>):void; replaceAll(BiFunction<K,V,V>):void; replace(K,V):V; equals(Object):boolean; hashCode():int; toString():String; ' +
        'static of():Map<K,V>; static entry(K,V):Map.Entry<K,V>; static copyOf(Map<K,V>):Map<K,V>; static ofEntries(Map.Entry<K,V>...):Map<K,V>',
      'I:Map.Entry<K,V> | getKey():K; getValue():V; setValue(V):V; equals(Object):boolean; hashCode():int; toString():String; ' +
        'static comparingByKey():Comparator<Map.Entry<K,V>>; static comparingByValue():Comparator<Map.Entry<K,V>>; static comparingByKey(Comparator<K>):Comparator<Map.Entry<K,V>>; static comparingByValue(Comparator<V>):Comparator<Map.Entry<K,V>>',
      'AbstractMap.SimpleEntry<K,V> : Map.Entry<K,V> | new(K,V)',
      'I:SequencedMap<K,V> : Map<K,V> | firstEntry():Map.Entry<K,V>; lastEntry():Map.Entry<K,V>; pollFirstEntry():Map.Entry<K,V>; pollLastEntry():Map.Entry<K,V>; reversed():SequencedMap<K,V>',
      'I:SortedMap<K,V> : SequencedMap<K,V> | firstKey():K; lastKey():K; headMap(K):SortedMap<K,V>; tailMap(K):SortedMap<K,V>; subMap(K,K):SortedMap<K,V>; comparator():Comparator<K>',
      'I:NavigableMap<K,V> : SortedMap<K,V> | floorKey(K):K; ceilingKey(K):K; higherKey(K):K; lowerKey(K):K; floorEntry(K):Map.Entry<K,V>; ceilingEntry(K):Map.Entry<K,V>; ' +
        'higherEntry(K):Map.Entry<K,V>; lowerEntry(K):Map.Entry<K,V>; descendingMap():NavigableMap<K,V>; descendingKeySet():NavigableSet<K>; navigableKeySet():NavigableSet<K>; ' +
        'headMap(K,boolean):NavigableMap<K,V>; tailMap(K,boolean):NavigableMap<K,V>',
      'HashMap<K,V> : Map<K,V> | clone():Object; new(); new(Object)',
      'LinkedHashMap<K,V> : HashMap<K,V>, SequencedMap<K,V> | new(); new(Object); new(int,float,boolean)',
      'TreeMap<K,V> : NavigableMap<K,V> | new(); new(Object)',
      'Hashtable<K,V> : HashMap<K,V> | new(); new(Object)',
      'EnumMap<K,V> : TreeMap<K,V> | new(Object)',
      'EnumSet<E> : TreeSet<E> | static of(E...):EnumSet<E>; static allOf(Class<E>):EnumSet<E>; static noneOf(Class<E>):EnumSet<E>; static range(E,E):EnumSet<E>; static copyOf(Collection<E>):EnumSet<E>; static complementOf(EnumSet<E>):EnumSet<E>',
      'IdentityHashMap<K,V> : HashMap<K,V> | new()',
      'WeakHashMap<K,V> : HashMap<K,V> | new()',
      'ConcurrentHashMap<K,V> : HashMap<K,V> | new(); new(Object)',
      'CopyOnWriteArrayList<E> : ArrayList<E> | new(); new(Object)',
      'I:RandomAccess',
      'Collections | static sort(List<T>):void; static sort(List<T>,Comparator<T>):void; static reverse(List<Object>):void; static shuffle(List<Object>):void; static shuffle(List<Object>,Random):void; ' +
        'static max(Collection<T>):T; static max(Collection<T>,Comparator<T>):T; static min(Collection<T>):T; static min(Collection<T>,Comparator<T>):T; ' +
        'static unmodifiableList(List<T>):List<T>; static unmodifiableSet(Set<T>):Set<T>; static unmodifiableMap(Map<K,V>):Map<K,V>; static unmodifiableCollection(Collection<T>):Collection<T>; ' +
        'static synchronizedList(List<T>):List<T>; static synchronizedMap(Map<K,V>):Map<K,V>; static emptyList():List<T>; static emptySet():Set<T>; static emptyMap():Map<K,V>; ' +
        'static singletonList(T):List<T>; static singleton(T):Set<T>; static singletonMap(K,V):Map<K,V>; static nCopies(int,T):List<T>; static frequency(Collection<Object>,Object):int; ' +
        'static swap(List<Object>,int,int):void; static addAll(Collection<T>,T...):boolean; static fill(List<T>,T):void; static reverseOrder():Comparator<T>; ' +
        'static reverseOrder(Comparator<T>):Comparator<T>; static disjoint(Collection<Object>,Collection<Object>):boolean; static binarySearch(List<T>,T):int; static rotate(List<Object>,int):void',
      'Arrays | static toString(Object):String; static deepToString(Object):String; static sort(Object):void; static sort(Object,Comparator<Object>):void; static sort(Object,int,int):void; ' +
        'static fill(Object,Object):void; static fill(Object,int,int,Object):void; static asList(T...):List<T>; static copyOf(T,int):T; static copyOfRange(T,int,int):T; ' +
        'static equals(Object,Object):boolean; static deepEquals(Object,Object):boolean; static hashCode(Object):int; static binarySearch(Object,Object):int; static stream(Object):Object; static setAll(Object,Object):void',
      'Optional<T> | isPresent():boolean; isEmpty():boolean; get():T; orElse(T):T; orElseGet(Supplier<T>):T; orElseThrow():T; orElseThrow(Supplier<Object>):T; ' +
        'ifPresent(Consumer<T>):void; ifPresentOrElse(Consumer<T>,Runnable):void; map(Function<T,U>):Optional<U>; flatMap(Function<T,Optional<U>>):Optional<U>; ' +
        'filter(Predicate<T>):Optional<T>; or(Supplier<Optional<T>>):Optional<T>; stream():Stream<T>; equals(Object):boolean; toString():String; ' +
        'static of(T):Optional<T>; static ofNullable(T):Optional<T>; static empty():Optional<T>',
      'OptionalInt | isPresent():boolean; isEmpty():boolean; getAsInt():int; orElse(int):int; orElseGet(IntSupplier):int; orElseThrow():int; ifPresent(IntConsumer):void; ifPresentOrElse(IntConsumer,Runnable):void; toString():String; static of(int):OptionalInt; static empty():OptionalInt',
      'OptionalLong | isPresent():boolean; isEmpty():boolean; getAsLong():long; orElse(long):long; orElseThrow():long; ifPresent(Consumer<Object>):void; toString():String',
      'OptionalDouble | isPresent():boolean; isEmpty():boolean; getAsDouble():double; orElse(double):double; orElseGet(DoubleSupplier):double; orElseThrow():double; ifPresent(DoubleConsumer):void; toString():String; static of(double):OptionalDouble; static empty():OptionalDouble',
      'Random | nextInt():int; nextInt(int):int; nextInt(int,int):int; nextLong():long; nextLong(long):long; nextLong(long,long):long; nextDouble():double; nextDouble(double):double; nextDouble(double,double):double; nextFloat():float; ' +
        'nextBoolean():boolean; nextGaussian():double; setSeed(long):void; ints(long,int,int):IntStream; ints(int,int):IntStream; doubles(long):DoubleStream; new(); new(long)',
      'ThreadLocalRandom : Random | static current():ThreadLocalRandom',
      'UUID | toString():String; static randomUUID():UUID',
      'Locale | static ROOT:Locale; static US:Locale; static ENGLISH:Locale; static UK:Locale; static GERMANY:Locale; static FRANCE:Locale; static getDefault():Locale; static forLanguageTag(String):Locale',
      'TimeUnit | static MILLISECONDS:TimeUnit; static SECONDS:TimeUnit; sleep(long):void',
      'Instant | toEpochMilli():long; static now():Instant',
      'Duration | toMillis():long; getSeconds():long; toSeconds():long; static ofMillis(long):Duration; static ofSeconds(long):Duration; static between(Instant,Instant):Duration',
      // функциональные интерфейсы
      'I:Function<T,R> | *apply(T):R; andThen(Function<R,V>):Function<T,V>; compose(Function<V,T>):Function<V,R>; static identity():Function<T,T>',
      'I:BiFunction<T,U,R> | *apply(T,U):R; andThen(Function<R,V>):BiFunction<T,U,V>',
      'I:Supplier<T> | *get():T',
      'I:Consumer<T> | *accept(T):void; andThen(Consumer<T>):Consumer<T>=andThenC',
      'I:BiConsumer<T,U> | *accept(T,U):void; andThen(BiConsumer<T,U>):BiConsumer<T,U>=andThenC',
      'I:Predicate<T> | *test(T):boolean; and(Predicate<T>):Predicate<T>; or(Predicate<T>):Predicate<T>; negate():Predicate<T>; static not(Predicate<T>):Predicate<T>; static isEqual(Object):Predicate<T>',
      'I:BiPredicate<T,U> | *test(T,U):boolean; and(BiPredicate<T,U>):BiPredicate<T,U>; or(BiPredicate<T,U>):BiPredicate<T,U>; negate():BiPredicate<T,U>',
      'I:UnaryOperator<T> : Function<T,T> | *apply(T):T; static identity():UnaryOperator<T>',
      'I:BinaryOperator<T> : BiFunction<T,T,T> | *apply(T,T):T; static minBy(Comparator<T>):BinaryOperator<T>; static maxBy(Comparator<T>):BinaryOperator<T>',
      'I:Comparator<T> | *compare(T,T):int; reversed():Comparator<T>; thenComparing(Object):Comparator<T>; thenComparing(Function<T,U>,Comparator<U>):Comparator<T>; ' +
        'thenComparingInt(ToIntFunction<T>):Comparator<T>; thenComparingDouble(ToDoubleFunction<T>):Comparator<T>; thenComparingLong(ToLongFunction<T>):Comparator<T>; ' +
        'static comparing(Function<T,U>):Comparator<T>; static comparing(Function<T,U>,Comparator<U>):Comparator<T>; static comparingInt(ToIntFunction<T>):Comparator<T>; ' +
        'static comparingDouble(ToDoubleFunction<T>):Comparator<T>; static comparingLong(ToLongFunction<T>):Comparator<T>; static naturalOrder():Comparator<T>; ' +
        'static reverseOrder():Comparator<T>; static nullsFirst(Comparator<T>):Comparator<T>; static nullsLast(Comparator<T>):Comparator<T>',
      'I:IntFunction<R> | *apply(int):R', 'I:IntPredicate | *test(int):boolean; and(IntPredicate):IntPredicate; or(IntPredicate):IntPredicate; negate():IntPredicate',
      'I:IntUnaryOperator | *applyAsInt(int):int; andThen(IntUnaryOperator):IntUnaryOperator; compose(IntUnaryOperator):IntUnaryOperator; static identity():IntUnaryOperator',
      'I:IntBinaryOperator | *applyAsInt(int,int):int', 'I:ToIntFunction<T> | *applyAsInt(T):int', 'I:ToLongFunction<T> | *applyAsLong(T):long', 'I:ToDoubleFunction<T> | *applyAsDouble(T):double',
      'I:ToIntBiFunction<T,U> | *applyAsInt(T,U):int', 'I:ToDoubleBiFunction<T,U> | *applyAsDouble(T,U):double', 'I:IntConsumer | *accept(int):void; andThen(IntConsumer):IntConsumer=andThenC', 'I:IntSupplier | *getAsInt():int',
      'I:DoubleFunction<R> | *apply(double):R', 'I:DoubleUnaryOperator | *applyAsDouble(double):double; andThen(DoubleUnaryOperator):DoubleUnaryOperator; static identity():DoubleUnaryOperator',
      'I:DoubleBinaryOperator | *applyAsDouble(double,double):double', 'I:DoublePredicate | *test(double):boolean; negate():DoublePredicate', 'I:DoubleSupplier | *getAsDouble():double', 'I:DoubleConsumer | *accept(double):void',
      'I:LongFunction<R> | *apply(long):R', 'I:LongUnaryOperator | *applyAsLong(long):long', 'I:LongBinaryOperator | *applyAsLong(long,long):long', 'I:LongPredicate | *test(long):boolean',
      'I:LongSupplier | *getAsLong():long', 'I:LongConsumer | *accept(long):void', 'I:IntToDoubleFunction | *applyAsDouble(int):double', 'I:IntToLongFunction | *applyAsLong(int):long',
      'I:DoubleToIntFunction | *applyAsInt(double):int', 'I:LongToIntFunction | *applyAsInt(long):int', 'I:ObjIntConsumer<T> | *accept(T,int):void', 'I:BooleanSupplier | *getAsBoolean():boolean',
      // потоки (streams)
      'I:BaseStream | iterator():Iterator<Object>; close():void; parallel():Object; sequential():Object; unordered():Object',
      'I:Stream<T> : BaseStream | filter(Predicate<T>):Stream<T>; map(Function<T,R>):Stream<R>; mapToInt(ToIntFunction<T>):IntStream; mapToLong(ToLongFunction<T>):LongStream; ' +
        'mapToDouble(ToDoubleFunction<T>):DoubleStream; flatMap(Function<T,Stream<R>>):Stream<R>; distinct():Stream<T>; sorted():Stream<T>; sorted(Comparator<T>):Stream<T>; ' +
        'peek(Consumer<T>):Stream<T>; limit(long):Stream<T>; skip(long):Stream<T>; takeWhile(Predicate<T>):Stream<T>; dropWhile(Predicate<T>):Stream<T>; forEach(Consumer<T>):void; ' +
        'forEachOrdered(Consumer<T>):void; toArray():Object[]; toArray(IntFunction<Object>):T[]; reduce(T,BinaryOperator<T>):T; reduce(BinaryOperator<T>):Optional<T>; ' +
        'collect(Object):Object; toList():List<T>; min(Comparator<T>):Optional<T>; max(Comparator<T>):Optional<T>; count():long; anyMatch(Predicate<T>):boolean; ' +
        'allMatch(Predicate<T>):boolean; noneMatch(Predicate<T>):boolean; findFirst():Optional<T>; findAny():Optional<T>; iterator():Iterator<T>; ' +
        'static of(T...):Stream<T>; static ofNullable(T):Stream<T>; static empty():Stream<T>; static iterate(T,UnaryOperator<T>):Stream<T>; static iterate(T,Predicate<T>,UnaryOperator<T>):Stream<T>; ' +
        'static generate(Supplier<T>):Stream<T>; static concat(Stream<T>,Stream<T>):Stream<T>',
      'I:IntStream : BaseStream | map(IntUnaryOperator):IntStream; mapToObj(IntFunction<R>):Stream<R>; mapToDouble(IntToDoubleFunction):DoubleStream; mapToLong(IntToLongFunction):LongStream; ' +
        'flatMap(IntFunction<IntStream>):IntStream; filter(IntPredicate):IntStream; boxed():Stream<Integer>; sum():int; average():OptionalDouble; min():OptionalInt; max():OptionalInt; ' +
        'count():long; toArray():int[]; forEach(IntConsumer):void; sorted():IntStream; distinct():IntStream; limit(long):IntStream; skip(long):IntStream; peek(IntConsumer):IntStream; ' +
        'anyMatch(IntPredicate):boolean; allMatch(IntPredicate):boolean; noneMatch(IntPredicate):boolean; reduce(int,IntBinaryOperator):int; reduce(IntBinaryOperator):OptionalInt; ' +
        'asDoubleStream():DoubleStream; asLongStream():LongStream; summaryStatistics():IntSummaryStatistics; findFirst():OptionalInt; findAny():OptionalInt; ' +
        'takeWhile(IntPredicate):IntStream; dropWhile(IntPredicate):IntStream; iterator():Iterator<Integer>; ' +
        'static range(int,int):IntStream; static rangeClosed(int,int):IntStream; static of(int...):IntStream; static iterate(int,IntUnaryOperator):IntStream; ' +
        'static iterate(int,IntPredicate,IntUnaryOperator):IntStream; static generate(IntSupplier):IntStream; static empty():IntStream; static concat(IntStream,IntStream):IntStream',
      'I:LongStream : BaseStream | map(LongUnaryOperator):LongStream; mapToObj(LongFunction<R>):Stream<R>; mapToInt(LongToIntFunction):IntStream; filter(LongPredicate):LongStream; boxed():Stream<Long>; ' +
        'sum():long; average():OptionalDouble; min():OptionalLong; max():OptionalLong; count():long; toArray():long[]; forEach(LongConsumer):void; sorted():LongStream; distinct():LongStream; ' +
        'limit(long):LongStream; skip(long):LongStream; anyMatch(LongPredicate):boolean; allMatch(LongPredicate):boolean; noneMatch(LongPredicate):boolean; reduce(long,LongBinaryOperator):long; ' +
        'static range(long,long):LongStream; static rangeClosed(long,long):LongStream; static of(long...):LongStream; static empty():LongStream',
      'I:DoubleStream : BaseStream | map(DoubleUnaryOperator):DoubleStream; mapToObj(DoubleFunction<R>):Stream<R>; mapToInt(DoubleToIntFunction):IntStream; filter(DoublePredicate):DoubleStream; ' +
        'boxed():Stream<Double>; sum():double; average():OptionalDouble; min():OptionalDouble; max():OptionalDouble; count():long; toArray():double[]; forEach(DoubleConsumer):void; ' +
        'sorted():DoubleStream; distinct():DoubleStream; limit(long):DoubleStream; skip(long):DoubleStream; peek(DoubleConsumer):DoubleStream; anyMatch(DoublePredicate):boolean; ' +
        'allMatch(DoublePredicate):boolean; noneMatch(DoublePredicate):boolean; reduce(double,DoubleBinaryOperator):double; findFirst():OptionalDouble; summaryStatistics():DoubleSummaryStatistics; ' +
        'static of(double...):DoubleStream; static empty():DoubleStream; static iterate(double,DoubleUnaryOperator):DoubleStream; static generate(DoubleSupplier):DoubleStream',
      'IntSummaryStatistics | getMin():int; getMax():int; getAverage():double; getSum():long; getCount():long; accept(int):void; toString():String; new()',
      'DoubleSummaryStatistics | getMin():double; getMax():double; getAverage():double; getSum():double; getCount():long; accept(double):void; toString():String; new()',
      'Collectors | static toList():Object; static toUnmodifiableList():Object; static toSet():Object; static toUnmodifiableSet():Object; static joining():Object; static joining(CharSequence):Object; ' +
        'static joining(CharSequence,CharSequence,CharSequence):Object; static groupingBy(Object):Object; static groupingBy(Object,Object):Object; static groupingBy(Object,Object,Object):Object; ' +
        'static counting():Object; static summingInt(Object):Object; static summingLong(Object):Object; static summingDouble(Object):Object; static averagingInt(Object):Object; ' +
        'static averagingLong(Object):Object; static averagingDouble(Object):Object; static toMap(Object,Object):Object; static toMap(Object,Object,Object):Object; static toMap(Object,Object,Object,Object):Object; ' +
        'static partitioningBy(Object):Object; static partitioningBy(Object,Object):Object; static mapping(Object,Object):Object; static minBy(Object):Object; static maxBy(Object):Object; ' +
        'static toCollection(Object):Object; static collectingAndThen(Object,Object):Object; static filtering(Object,Object):Object; static reducing(Object,Object):Object; static summarizingInt(Object):Object',
    ];
    for (const [n, b] of EXC_LIST) LIBSRC.push(n + ' : ' + b + (n === 'Throwable' ? ' | getMessage():String; getLocalizedMessage():String; getCause():Throwable; printStackTrace():void; toString():String; ' +
      'getStackTrace():Object[]; initCause(Throwable):Throwable; addSuppressed(Throwable):void; getSuppressed():Throwable[];' : ' |') + ' new(); new(Object); new(String,Throwable)');
    // ── мир «Студии 3D» (объекты песочницы script.js, имена как в Roblox) — типы для подсказок, лямбд и печати ──
    const STUDIO_SRC = [
      'Part | Name:String; Parent:Part; ClassName:String; Position:Vector3; Size:Vector3; Orientation:Vector3; Rotation:Vector3; CFrame:CFrame; Color:Color3; Transparency:double; ' +
        'Material:String; CanCollide:boolean; Anchored:boolean; CastShadow:boolean; Shape:String; Reflectance:double; Touched:TouchSignal; TouchEnded:TouchSignal; Clicked:PlayerSignal; ' +
        'Destroy():void; Clone():Part; FindFirstChild(String):Part; FindFirstChild(String,boolean):Part; WaitForChild(String):Part; FindFirstChildOfClass(String):Part; ' +
        'GetChildren():List<Part>; GetDescendants():List<Part>; IsA(String):boolean; IsDescendantOf(Part):boolean; GetAttribute(String):Object; SetAttribute(String,Object):void; ' +
        'Prompt(String):Prompt; Prompt(String,double):Prompt; GetFullName():String; PivotTo(CFrame):void; GetPivot():CFrame; ClearAllChildren():void; toString():String',
      'Player | Name:String; DisplayName:String; UserId:String; Humanoid:Humanoid; Character:Part; Position:Vector3; CharacterAdded:PartSignal; AddStat(String,double):void; ' +
        'SetStat(String,Object):void; GetStat(String):Object; Message(String):void; Message(String,double):void; Teleport(Vector3):void; FindFirstChild(String):Part; IsA(String):boolean; ' +
        'Kick():void; Kick(String):void; toString():String',
      'Humanoid | Health:double; MaxHealth:double; WalkSpeed:double; JumpPower:double; Died:Signal; TakeDamage(double):void',
      'Vector3 | X:double; Y:double; Z:double; x:double; y:double; z:double; Magnitude:double; Unit:Vector3; add(Vector3):Vector3; sub(Vector3):Vector3; mul(Object):Vector3; ' +
        'div(Object):Vector3; Dot(Vector3):double; Cross(Vector3):Vector3; Lerp(Vector3,double):Vector3; FuzzyEq(Vector3):boolean; Distance(Vector3):double; Angle(Vector3):double; ' +
        'toString():String; equals(Object):boolean; hashCode():int; static zero:Vector3; static one:Vector3; static up:Vector3; static down:Vector3; static forward:Vector3; static back:Vector3; ' +
        'static left:Vector3; static right:Vector3; static distance(Vector3,Vector3):double; static lerp(Vector3,Vector3,double):Vector3; new(); new(double,double,double)',
      'Color3 | static fromRGB(int,int,int):Color3; static fromHSV(double,double,double):Color3; static fromHex(String):Color3; toString():String; new(double,double,double)',
      'CFrame | X:double; Y:double; Z:double; Position:Vector3; LookVector:Vector3; RightVector:Vector3; UpVector:Vector3; mul(Object):Object; add(Vector3):CFrame; sub(Vector3):CFrame; ' +
        'Inverse():CFrame; static Angles(double,double,double):CFrame; static lookAt(Vector3,Vector3):CFrame; new(); new(Object); new(double,double,double); new(Vector3,Vector3)',
      'BrickColor | Name:String; Color:Color3; static Random():BrickColor; new(Object)',
      'TouchSignal | Connect(BiConsumer<Part,Player>):Connection; Wait():Object', 'PlayerSignal | Connect(Consumer<Player>):Connection; Wait():Player',
      'PartSignal | Connect(Consumer<Part>):Connection; Wait():Part', 'BeatSignal | Connect(Consumer<Double>):Connection; Wait():double',
      'Signal | Connect(AnyFn):Connection; Wait():Object', 'Connection | Connected:boolean; Disconnect():void',
      'Prompt | Triggered:PlayerSignal; ActionText:String; ObjectText:String; HoldDuration:double; MaxActivationDistance:double; Enabled:boolean',
      'Tween | Completed:Signal; Play():Tween; Cancel():void; Pause():void',
      'TweenInfo | Time:double; new(double); new(double,Object); new(double,Object,Object); new(double,Object,Object,int); new(double,Object,Object,int,boolean); new(double,Object,Object,int,boolean,double)',
      'TweenService | static Create(Part,Object,Object):Tween', 'RunService | static Heartbeat:BeatSignal; static Stepped:BeatSignal',
      'Players | static PlayerAdded:PlayerSignal; static PlayerRemoving:PlayerSignal; static LocalPlayer:Player; static GetPlayers():List<Player>; static GetPlayerFromCharacter(Part):Player',
      'Debris | static AddItem(Part,double):void', 'Instance | static create(String):Part; static create(String,Part):Part',
      'TaskLib | wait():double; wait(double):double; delay(double,Runnable):void; spawn(Runnable):void', 'GuiLib | message(String):void; message(String,double):void; text(String,String):void; clear(String):void',
      'SoundLib | play(String):void; play(String,Object):void',
      'GameModes | Mode:String; State:String; Round:int; Rounds:int; TimeLeft:double; RoundStart:Signal; RoundEnd:Signal; MatchEnd:Signal; Workspace:Part; AddScore(Player,double):void; ' +
        'GetScore(Player):double; GetTeam(Player):int; SetTeam(Player,int):void; EndRound():void; EndRound(Player):void; StartMatch():void; GetService(String):Object',
      'CameraLib | Mode:String; SetMode(String):void; SetMode(String,Player):void; Shake(double,double):void',
      'WeatherLib | State:String; Season:String; Temperature:double; FeelsLike:double; Wind:double; Rain:double; Snow:double; Today:String; Changed:Signal; Holiday:Signal; Set(String):void',
      'SupportLib | Mode:String; Holds(Part):boolean; Get(Part):double; Break(Part):void; Collapsed:PartSignal',
      'FireLib | Count:int; IsBurning(Part):boolean; Ignite(Part):void; Extinguish(Part):void; Ignited:PartSignal; Burnt:PartSignal; Extinguished:PartSignal',
      'EnumLib', 'I:AnyFn',
      // базовый класс скриптов-классов (как MonoBehaviour в Unity): start(), update(double dt), onTouched(Part, Player) …
      'Script | Parent:Part; script:Part; enabled:boolean; getParent():Part; print(Object...):void; wait():double; wait(double):double; delay(double,Runnable):void; spawn(Runnable):void; destroy():void; destroy(double):void; isEnabled():boolean; setEnabled(boolean):void; toString():String; new()',
    ];
    const MODAPI_SRC = [
      // API модов (docs/MODS.md): mod, world, fx, npc, commands, player, game — у «Кубомира» координаты x, y, z, у «Подземья» — x, y
      'ModApi | id:String; api:int; storage:ModStorage; on(String,Consumer<ModEvent>):void; on(String,Object,Consumer<ModEvent>):void; log(Object...):void; command(String,Consumer<String[]>):void; wait(double):double',
      'ModStorage | get(String):Object; set(String,Object):void; remove(String):void',
      'ModWorld | get(int,int):String; get(int,int,int):String; set(int,int,String):boolean; set(int,int,int,String):boolean; wall(int,int):String; liquid(int,int):String; liquid(int,int,int):String; ' +
        'setWall(int,int,String):boolean; isNight():boolean; time():double; day():int; hours():double; read(int,int,int):String; view():Object',
      'ModFx | particles(Object...):boolean; sound(String):boolean; sound(String,double):boolean; text(Object...):boolean; shake(double):boolean',
      'ModNpc | say(String):boolean; addLine(String):boolean', 'ModCommands | add(String,Consumer<String[]>):void; add(String,String,Consumer<String[]>):void',
      'ModPlayer | x:double; y:double; z:double; hp:double; maxHp:double; health:double; food:double; name:String; mode:String; item:String; sneaking:boolean; give(String):boolean; give(String,int):boolean; ' +
        'heal(double):boolean; message(String):boolean; hurt(double):boolean; launch(double,double,double):boolean; teleport(double,double,double):boolean',
      'ModGame | time:double; night:boolean; day:int; spawn(String,double,double):boolean; spawn(String,double,double,double):boolean',
      'ModEvent | type:String; x:int; y:int; z:int; tile:String; item:String; mob:String; text:String; npc:String; n:int; dt:double; player:ModPlayer',
    ];
    const MC_SRC = [];   // фасад Fabric/Forge — ниже, раздел «Моды»
    // ── разбор библиотеки (один раз на режим): studio — база + мир «Студии 3D»; mod — база + API модов + фасад Fabric/Forge ──
    const LIBS = {};
    const TVAR = /^[A-Z][0-9]?$/;
    let LIB = null;   // библиотека текущего перевода
    function lib(mode){
      if (!mode) return LIB || lib('studio');
      if (LIBS[mode]) return LIBS[mode];
      const L = LIBS[mode] = new Map();
      const WORLD = new Set(mode === 'mod' ? MODAPI_SRC : STUDIO_SRC.filter(x => !/^Script /.test(x)));
      for (const line of LIBSRC.concat(mode === 'mod' ? MODAPI_SRC.concat(MC_SRC) : STUDIO_SRC)) {
        const bar = line.indexOf(' | ');
        let h = (bar >= 0 ? line.slice(0, bar) : line).trim();
        const body = bar >= 0 ? line.slice(bar + 3) : '';
        let iface = false, extOk = false;
        if (h.startsWith('I:')) { iface = true; h = h.slice(2); }
        if (h.startsWith('X:')) { extOk = true; h = h.slice(2); }   // класс фасада, от которого можно наследовать (Block, Item …)
        const ci = h.indexOf(' : ');
        const nameT = (ci >= 0 ? h.slice(0, ci) : h).trim().replace(/\s+/g, '');
        const ext = ci >= 0 ? splitTop(h.slice(ci + 3).replace(/\s+/g, '')).filter(Boolean) : [];
        const name = genName(nameT), tps = genArgs(nameT);
        const e = { name, tps, ext, iface, extOk, m: new Map(), s: new Map(), f: new Map(), sf: new Map(), ctor: [], fi: null, lib: true, world: WORLD.has(line), mc: MC_SRC.includes(line) };
        for (let mem of body.split(';')) {
          mem = mem.trim(); if (!mem) continue;
          let st = false, star = false, js = null;
          if (mem.startsWith('static ')) { st = true; mem = mem.slice(7).trim(); }
          if (mem.startsWith('*')) { star = true; mem = mem.slice(1); }
          const po = mem.indexOf('(');
          if (po < 0) { const c = mem.indexOf(':'); (st ? e.sf : e.f).set(mem.slice(0, c).trim(), mem.slice(c + 1).trim()); continue; }
          const pc = mem.indexOf(')', po), eq = mem.indexOf('=', pc);
          if (eq > 0) { js = mem.slice(eq + 1).trim(); mem = mem.slice(0, eq); }
          const nm = mem.slice(0, po).trim(), pstr = mem.slice(po + 1, pc).replace(/\s+/g, '');
          const ret = mem.slice(pc + 1).replace(/^:/, '').trim() || 'void';
          let ps = pstr ? splitTop(pstr) : [], va = false;
          if (ps.length && ps[ps.length - 1].endsWith('...')) { va = true; ps[ps.length - 1] = ps[ps.length - 1].slice(0, -3) + '[]'; }
          const mt = new Set();
          for (const t of ps.concat([ret])) for (const id of t.match(/\b[A-Z][0-9]?\b/g) || []) if (st || !tps.includes(id)) mt.add(id);
          const sig = { name: nm, ps, va, ret, st, js: js || nm, owner: name, mtps: [...mt], lib: true };
          if (nm === 'new') { sig.ret = name; e.ctor.push(sig); continue; }
          const M = st ? e.s : e.m;
          if (!M.has(nm)) M.set(nm, []);
          M.get(nm).push(sig);
          if (star) e.fi = sig;
        }
        L.set(name, e);
      }
      return L;
    }
    // ═══ 5. Генератор JS ═══
    const JSRES = new Set(('String Number Math BigInt Object Array Symbol JSON Error Promise Map Set Date Reflect Proxy RegExp Boolean Function globalThis arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally ' +
      'for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true ' +
      'try typeof var void while with yield undefined NaN Infinity async of let').split(' '));
    const jsName = n => n.startsWith('$') ? 'u' + n : JSRES.has(n) ? n + '$' : n;
    const mjs = n => n.startsWith('$') ? 'u' + n : n === 'constructor' || n === 'prototype' || n === '__proto__' ? n + '$' : n;
    const fkey = n => JSON.stringify('#' + n);   // ключ поля объекта Java
    // пакеты, которые есть (импорт — без ошибки); остальное — понятная ошибка
    const PKG_OK = /^(java\.lang|java\.util(\.function|\.stream|\.concurrent(\.atomic)?|\.regex)?|java\.math|java\.time|java\.text|net\.minecraft|net\.fabricmc|com\.mojang|org\.slf4j|org\.apache\.logging|net\.minecraftforge|net\.neoforged|com\.google\.common|org\.jetbrains|javax\.annotation|lombok|d37|roblox|dan4ik37)(\.|$)/;
    const PKG_NO = [[/^java\.(io|nio)(\.|$)/, 'файлов в песочнице нет (java.io / java.nio)'], [/^java\.net(\.|$)/, 'сети в песочнице нет (java.net)'],
      [/^java\.lang\.reflect(\.|$)/, 'рефлексия не поддерживается'], [/^java\.(awt|applet)|^javax\.swing/, 'окон и графики Java (AWT/Swing) нет — рисует игра'],
      [/^java\.sql|^javax\.sql/, 'баз данных нет'], [/^java\.lang\.Thread$|^java\.util\.concurrent\.(Executor|Thread|Future|CompletableFuture)/, 'потоков нет: скрипт идёт в одном потоке — жди через wait(сек) или Thread.sleep(мс)'],
      [/^java\.util\.Scanner$/, 'ввода с клавиатуры (Scanner) нет: данные — в коде, события — Touched / Prompt / команды'], [/^java\.lang\.invoke(\.|$)/, 'java.lang.invoke не поддерживается']];
    const NOPE = {
      Scanner: 'ввода с клавиатуры (Scanner) нет: данные — в коде, события — Touched / Prompt / команды', BufferedReader: 'файлов и ввода нет (java.io)', File: 'файлов нет (песочница)',
      FileReader: 'файлов нет (песочница)', FileWriter: 'файлов нет (песочница)', InputStreamReader: 'ввода нет (песочница)', Files: 'файлов нет (песочница)', Path: 'файлов нет (песочница)', Paths: 'файлов нет (песочница)',
      Socket: 'сети нет (песочница)', URL: 'сети нет (песочница)', HttpClient: 'сети нет (песочница)', ExecutorService: 'потоков нет: используй wait(сек) или task.delay(сек, () -> …)',
      Executors: 'потоков нет: используй wait(сек) или task.delay(сек, () -> …)', CompletableFuture: 'потоков нет: используй wait(сек) или task.delay(сек, () -> …)',
      Timer: 'Timer не нужен: task.delay(сек, () -> …) или wait(сек) в цикле', ReentrantLock: 'блокировок нет: всё в одном потоке', AtomicInteger: null, Method: 'рефлексия не поддерживается', Field: 'рефлексия не поддерживается',
      JFrame: 'окон Java (Swing) нет — рисует игра', Graphics: 'рисования Java (AWT) нет — меняй детали мира', BigInteger: 'BigInteger нет — используй long (64 бита)', BigDecimal: 'BigDecimal нет — используй double',
    };
    // тип API-глобалов по режиму: в «Студии 3D» — мир как в Roblox, в модах — API модов
    const STUDIO_G = { script: 'Part', workspace: 'Part', game: 'GameModes', Game: 'GameModes', Camera: 'CameraLib', Weather: 'WeatherLib', Support: 'SupportLib', Fire: 'FireLib', task: 'TaskLib', gui: 'GuiLib', sound: 'SoundLib', Enum: 'EnumLib' };
    const MOD_G = { mod: 'ModApi', world: 'ModWorld', fx: 'ModFx', npc: 'ModNpc', commands: 'ModCommands', player: 'ModPlayer', game: 'ModGame' };
    const STUDIO_T = new Set(['Vector3', 'Color3', 'CFrame', 'BrickColor', 'TweenService', 'TweenInfo', 'RunService', 'Players', 'Debris', 'Instance', 'Part', 'Player', 'Humanoid',
      'TouchSignal', 'PlayerSignal', 'PartSignal', 'BeatSignal', 'Signal', 'Connection', 'Prompt', 'Tween', 'Script', 'GameModes', 'CameraLib', 'WeatherLib', 'SupportLib', 'FireLib', 'TaskLib', 'GuiLib', 'SoundLib']);
    const ALIAS_T = { BasePart: 'Part', MeshPart: 'Part', Model: 'Part', Folder: 'Part', Workspace: 'Part', SpawnLocation: 'Part', WedgePart: 'Part', PointLight: 'Part',
      MonoBehaviour: 'Script', Behaviour: 'Script', StringBuffer: 'StringBuilder', ArrayIndexOutOfBounds: 'ArrayIndexOutOfBoundsException' };
    const STUDIO_ALIAS = new Set(['BasePart', 'MeshPart', 'Model', 'Folder', 'Workspace', 'SpawnLocation', 'WedgePart', 'PointLight', 'MonoBehaviour', 'Behaviour']);
    const OBJ_METHODS = new Set(['equals', 'hashCode', 'toString', 'getClass']);
    // методы, которые вызывает сама библиотека (сортировка, коллекции, печать) — в них ждать (wait) нельзя
    const SYNC_ONLY = new Set(['toString', 'equals', 'hashCode', 'compareTo', 'compare', 'iterator', 'hasNext', 'next', 'apply', 'test', 'accept', 'get', 'applyAsInt', 'applyAsDouble', 'applyAsLong', 'getAsInt', 'getAsDouble', 'close']);

    function gen(U, XC, opts){
      const MODE = opts.mode || 'studio';
      LIB = lib(MODE);
      const CL = new Map();        // каноническое имя (Outer.Inner) → описание класса этого скрипта
      const XW = new Map();        // классы других скриптов этого запуска — обёртки ($.X("Имя"))
      const IMP = new Map();       // импорт: простое имя → полное имя
      const SIMP = new Map();      // import static: имя → тип
      const STARS = [];            // import a.b.*;
      const USED = new Set();      // нужные коду имена библиотеки ($A.Имя)
      let SC = null, FN = null, TMP = 0, PEND = null, LOOPS = [], STL = 0, PASS = 1, SUSP = null, EDGES = null, CUR = null;
      const imp = o => { let w = XW.get(o); if (w) return w; w = Object.create(o); w.js = '($.X(' + JSON.stringify(o.q) + '))'; w.ext = true; XW.set(o, w); if (o.baseC) w.baseC = imp(o.baseC); return w; };
      const tmp = () => { const n = '$t' + (++TMP); if (PEND) PEND.push(n); return n; };
      const pureCode = c => /^[\w$]+(\.[\w$]+|\[("[^"\\]*"|\d+)\])*$/.test(c) || /^-?\d+(\.\d+)?n?$/.test(c) || /^"([^"\\]|\\.)*"$/.test(c);
      const once = (c, pre) => { if (pureCode(c)) return c; const t = tmp(); pre.push(t + ' = ' + c); return t; };
      const seq = (pre, c) => pre.length ? '(' + pre.concat([c]).join(', ') + ')' : c;

      // ── импорт ──
      for (const im of U.imports) {
        if (im.st) {
          const parts = im.name.split('.'), owner = im.star ? normQ(parts) : normQ(parts.slice(0, -1));
          if (im.star) SIMP.set('*' + owner, owner); else SIMP.set(im.last, owner);
          continue;
        }
        for (const [re, why] of PKG_NO) if (re.test(im.name)) throw JErr('import ' + im.name + ': ' + why, im.line);
        if (im.star) { STARS.push(im.name); continue; }
        if (NOPE[im.last]) throw JErr('import ' + im.name + ': ' + NOPE[im.last], im.line);
        IMP.set(im.last, im.name);
      }

      // ── типы: разбор строки типа, каноническое имя ──
      function ptype(t){   // 'Map<String,List<Integer>>[]' → { b: 'Map', a: ['String', 'List<Integer>'], d: 1 }
        let d = 0; while (t.endsWith('[]')) { t = t.slice(0, -2); d++; }
        return { b: genName(t), a: genArgs(t), d };
      }
      const mkT = (b, a, d) => b + (a && a.length ? '<' + a.join(',') + '>' : '') + '[]'.repeat(d || 0);
      // свой класс по имени из контекста c (вложенные, внешние, локальные, верхние, других скриптов)
      function userType(name, c){
        if (!name) return null;
        if (name.includes('.')) {
          const parts = name.split('.');
          let cur = userType(parts[0], c);
          if (!cur) { const q = CL.get(name) || (XC && XC.get(name)); return q ? (XC && XC.get(name) && !CL.has(name) ? imp(XC.get(name)) : q) : null; }
          for (const p of parts.slice(1)) { const nx = nestedOf(cur, p); if (!nx) return null; cur = nx; }
          return cur;
        }
        for (let s = SC; s; s = s.up) { const lt = s.t && s.t.get(name); if (lt) return lt; }
        for (let x = c; x; x = x.outer || x.declCls) {
          if (x.name === name && !x.anon) return x;
          const n = nestedOf(x, name); if (n) return n;
        }
        const top = CL.get(name); if (top) return top;
        if (XC && XC.has(name)) return imp(XC.get(name));
        return null;
      }
      function nestedOf(c, name){
        for (let x = c, k = 0; x && k < 40; x = x.baseC, k++) { const n = x.nested && x.nested.get(name); if (n) return n; }
        for (const it of allIfaceC(c)) { const n = it.nested && it.nested.get(name); if (n) return n; }
        return null;
      }
      const libName = n => { if (MODE === 'studio' || !STUDIO_ALIAS.has(n)) n = ALIAS_T[n] || n; return lib().has(n) ? n : null; };
      // имя библиотечного типа (с учётом import и пакетов): java.util.Map.Entry → Map.Entry, Entry (import java.util.Map.Entry) → Map.Entry
      function libQ(b){
        let ln = libName(b);
        if (!ln) { const im = IMP.get(b.split('.')[0]); if (im) { const q = normQ(im.split('.').concat(b.split('.').slice(1))); ln = libName(q) || libName(q.split('.').pop()); } }
        if (!ln && b.includes('.')) ln = libName(b.split('.').pop());
        return ln;
      }
      // каноническая строка типа (имена своих классов — Outer.Inner); неизвестный тип — ошибка
      function canon(t, c, line, tvs){
        if (!t) return t;
        const P = ptype(t), b = P.b;
        const args = P.a.map(a => canon(a, c, line, tvs));
        let nb;
        if (b === 'var' && !P.a.length) nb = 'var';
        else if (NUMS.has(b) || b === 'boolean' || b === 'void') nb = b;
        else if (isTV(b, c, tvs)) nb = b;
        else {
          const u = userType(b, c);
          if (u) nb = u.q;
          else {
            const ln = libQ(b);
            if (ln) nb = ln;
            else {
              const short = b.split('.').pop();
              if (NOPE[short]) throw JErr(short + ': ' + NOPE[short], line);
              throw Object.assign(JErr('Тип «' + b + '» не найден' + typoHint(b), line), { unk: true });
            }
          }
        }
        return mkT(nb, args, P.d);
      }
      function isTV(name, c, tvs){
        if (tvs && tvs.includes(name)) return true;
        for (let f = FN; f; f = f.up) if (f.tps && f.tps.includes(name)) return true;
        for (let x = c; x; x = x.outer || x.declCls) if (x.tps && x.tps.includes(name)) return true;
        return false;
      }
      // похожее имя (опечатка): тот же текст в другом регистре или расстояние Левенштейна ≤ 1 (короткие) / 2
      function near(name, all){
        const lo = name.toLowerCase(), lim = name.length <= 4 ? 1 : 2;
        let best = null, bd = 99;
        for (const x of all) {
          if (!x || x === name || x[0] === '$' || x.includes('.')) continue;
          const xl = x.toLowerCase();
          if (xl === lo) return x;
          if (Math.abs(xl.length - lo.length) > lim) continue;
          let prev = Array.from({ length: xl.length + 1 }, (_, j) => j);
          for (let i = 1; i <= lo.length; i++) {
            const cur = [i];
            for (let j = 1; j <= xl.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (lo[i - 1] === xl[j - 1] ? 0 : 1));
            prev = cur;
          }
          const d = prev[xl.length];
          if (d < bd) { bd = d; best = x; }
        }
        return bd <= lim ? best : null;
      }
      function typoHint(b){
        const lo = b.toLowerCase(), all = [...lib().keys(), ...CL.keys()];
        const k = all.find(x => x.toLowerCase() === lo);
        if (k) return ' (может, ' + k + '? В Java важен регистр букв)';
        if ((b === 'Script' || b === 'MonoBehaviour') && MODE === 'mod') return ' — Script есть только в «Студии 3D»; в моде — class … implements ModInitializer и события';
        if (b === 'Block' || b === 'Item' || b === 'Registry' || b === 'Identifier') { if (MODE === 'studio') return ' — это классы Minecraft: они есть в модах «Кубомира» и «Подземья», а не в «Студии 3D»'; }
        if (b === 'string') return ' (в Java — String, с большой буквы)';
        if (b === 'Int' || b === 'integer') return ' (целое число — int)';
        if (b === 'bool' || b === 'Bool') return ' (в Java — boolean)';
        const nk = near(b, all.filter(x => /^[A-Z]/.test(x)));
        return nk ? ' (может, ' + nk + '?)' : '';
      }
      const isUserT = t => !!t && !NUMS.has(t) && t !== 'boolean' && !!userType(genName(t), CUR);
      const userC = t => { if (!t || isArrT(t)) return null; const c = CL.get(genName(t)) || (XC && XC.has(genName(t)) ? imp(XC.get(genName(t))) : null); return c || null; };
      const libE = t => (!t || isArrT(t)) ? null : lib().get(genName(t)) || null;

      // ── свои классы: сбор описаний ──
      let JSN = new Set(['$', '$A', '$S', '$F', '$G', '$Main']);
      const ANON = { n: 0 };
      function uniqJs(base){ let n = jsName(base.replace(/\./g, '$')), k = n, i = 1; while (JSN.has(k)) k = n + '$' + (++i); JSN.add(k); return k; }
      function collect(d, outer, o = {}){
        const st = !outer || d.kind !== 'class' || d.mods.has('static') || (outer && outer.kind === 'interface') || !!o.top;
        const c = { d, name: d.name, q: o.local || o.anon ? d.name : outer ? outer.q + '.' + d.name : d.name, kind: d.kind, outer: o.local || o.anon ? null : outer,
          declCls: o.local || o.anon ? outer : null, local: !!o.local, anon: !!o.anon, inner: !!outer && !st && !o.local && !o.anon, tps: (d.tps || []).map(x => x.name),
          tpb: Object.fromEntries((d.tps || []).map(x => [x.name, x.bound])), mem: new Map(), ctors: [], nested: new Map(), base: null, baseC: null, libBase: null, ifaces: [],
          abstract: d.mods.has('abstract') || d.kind === 'interface', iface: d.kind === 'interface', fields: [], consts: d.consts || null, comps: d.comps || null };
        if (o.anon) { c.q = (outer && !outer.implicit ? outer.q : 'Main') + '$' + (++ANON.n); c.js = 'Anon$' + ANON.n; }
        else c.js = uniqJs(c.q);
        if (d.kind === 'anno') return c;
        if (!o.local && !o.anon) { if (CL.has(c.q)) throw JErr('Тип «' + c.q + '» объявлен дважды', d.line); CL.set(c.q, c); }
        if (outer && !o.local && !o.anon) outer.nested.set(d.name, c);
        for (const m of d.members) if (m.m === 'type' && m.decl.kind !== 'anno') collect(m.decl, c);
        return c;
      }
      for (const d of U.types) if (d.kind !== 'anno' && !skipClient(d)) collect(d, null);
      // клиентская часть мода (рисование, клавиши) — @Environment(EnvType.CLIENT) / @OnlyIn(Dist.CLIENT) — пропускаем
      function skipClient(d){ return (d.annos || []).some(a => (a.name === 'Environment' || a.name === 'OnlyIn') && /CLIENT/.test(a.args)); }
      // неявный класс (методы и поля верхнего уровня, как в Java 25)
      const TOPM = U.items.filter(x => x.m === 'method' || x.m === 'field');
      const MAIN = { d: { name: '$Main', kind: 'class', members: TOPM, mods: new Set(['static']), line: (U.items[0] || {}).line || 1, end: (U.items[U.items.length - 1] || {}).line || 1 },
        name: '$Main', q: '$Main', js: '$Main', kind: 'class', outer: null, implicit: true, tps: [], tpb: {}, mem: new Map(), ctors: [], nested: new Map(), base: null, baseC: null,
        libBase: 'Object', ifaces: [], fields: [], abstract: false };

      // ── наследование: базовый класс, интерфейсы ──
      function headers(c){
        const d = c.d;
        CUR = c;
        if (c.kind === 'enum') c.libBase = 'Enum';
        else if (c.kind === 'record') c.libBase = 'Record';
        if (d.ext) {
          const bt = canon(d.ext, c.outer || c.declCls || c, d.line, c.tps), bc = userC(bt);
          if (bc) { if (bc.iface) throw JErr(bc.name + ' — интерфейс: пиши implements ' + bc.name, d.line); if (bc.kind !== 'class') throw JErr('От ' + bc.name + ' (' + bc.kind + ') наследовать нельзя', d.line); if (bc.d.mods.has('final')) throw JErr('Класс ' + bc.name + ' — final: от него наследовать нельзя', d.line); c.base = bt; c.baseC = bc; }
          else {
            const g = genName(bt);
            if (g === 'Script' || g === 'MonoBehaviour') { if (MODE === 'mod') throw JErr('Script — для «Студии 3D»; в моде — ModInitializer и события', d.line); c.libBase = 'Script'; c.script = true; }
            else if (EXC_LIST.some(x => x[0] === g)) { c.libBase = g; c.exc = true; }
            else if (g === 'Object') c.libBase = 'Object';
            else if (libE(bt) && libE(bt).extOk) { c.libBase = g; c.libBaseT = bt; c.mc = true; }
            else if (g === 'Thread') throw JErr('Потоков нет: вместо extends Thread — метод с wait(сек) или task.spawn(() -> …)', d.line);
            else { const e = libE(bt); if (e && !e.iface && (genName(bt) === 'ArrayList' || genName(bt) === 'HashMap' || genName(bt) === 'LinkedHashMap' || genName(bt) === 'HashSet' || genName(bt) === 'TreeMap')) { c.libBase = genName(bt); c.base = bt; } else throw JErr('От ' + g + ' наследовать нельзя (можно от своих классов, Script, исключений)', d.line); }
          }
        }
        for (const it of d.impl || []) {
          const t = canon(it, c.outer || c.declCls || c, d.line, c.tps), uc = userC(t);
          if (uc && !uc.iface) throw JErr(uc.name + ' — класс, а не интерфейс: пиши extends ' + uc.name, d.line);
          c.ifaces.push(t);
        }
        for (const n of c.nested.values()) headers(n);
        CUR = null;
      }
      function allIfaceC(c){   // свои интерфейсы класса (со всеми предками)
        const out = [], seen = new Set();
        const add = t => { const u = userC(t); if (!u || seen.has(u)) return; seen.add(u); out.push(u); for (const x of u.ifaces) add(x); };
        for (let x = c, k = 0; x && k < 40; x = x.baseC, k++) for (const t of x.ifaces || []) add(t);
        return out;
      }
      // все предки типа t (с подстановкой параметров): ArrayList<String> → List<String>, Collection<String>, Iterable<String>, Object
      function supers(t){
        const out = [], seen = new Set(), q = [t];
        while (q.length) {
          const x = q.shift(); if (!x || seen.has(genName(x) + '|' + x)) continue; seen.add(genName(x) + '|' + x); out.push(x);
          if (isArrT(x)) { q.push('Object'); continue; }
          const u = userC(x);
          if (u) {
            const map = {}; u.tps.forEach((n, i) => map[n] = genArgs(x)[i] || 'Object');
            if (u.base) q.push(subst(u.base, map)); else if (u.libBase && u.libBase !== 'Object') q.push(u.libBase);
            for (const it of u.ifaces) q.push(subst(it, map));
            if (u.kind === 'enum') q.push('Comparable<' + u.q + '>');
            q.push('Object');
            continue;
          }
          const e = libE(x);
          if (e) { const map = {}; e.tps.forEach((n, i) => map[n] = genArgs(x)[i] || 'Object'); for (const s of e.ext) q.push(subst(s, map)); if (x !== 'Object') q.push('Object'); }
        }
        return out;
      }
      const asSuper = (t, base) => { if (!t) return null; for (const s of supers(t)) if (genName(s) === base) return s; return null; };
      const elemOf = t => { if (!t) return null; if (isArrT(t)) return arrElem(t); const it = asSuper(t, 'Iterable'); return it ? (genArgs(it)[0] || null) : null; };
      // a можно присвоить переменной типа b? (null — неизвестно → можно)
      function assignable(a, b){
        if (!a || !b || a === b || b === 'Object' || b === 'var') return true;
        if (TVAR.test(b) || TVAR.test(a) || isTVName(a) || isTVName(b)) return true;
        const pa = prim(a), pb = prim(b);
        if (NUMS.has(pa) && NUMS.has(pb)) return widens(pa, pb) || (BOX[pa] && UNBOX[b] && widens(pa, pb));
        if (pa === 'boolean' || pb === 'boolean') return pa === pb;
        if (NUMS.has(pa) || NUMS.has(pb)) return (b === 'Number' || b === 'Comparable' || genName(b) === 'Comparable') && NUMS.has(pa);
        if (a === 'String' && genName(b) === 'CharSequence') return true;
        if (isArrT(a) || isArrT(b)) { if (isArrT(a) && isArrT(b)) { const ea = arrElem(a), eb = arrElem(b); return NUMS.has(ea) || ea === 'boolean' || NUMS.has(eb) || eb === 'boolean' ? ea === eb : assignable(ea, eb); } return b === 'Object' || genName(b) === 'Cloneable'; }
        const gb = genName(b);
        if (gb === 'AnyFn') return true;
        return supers(a).some(s => genName(s) === gb);
      }
      const isTVName = n => !!n && (TVAR.test(n) || isTV(n, CUR || (FN && FN.cls)));
      const WID = { byte: ['short', 'int', 'long', 'float', 'double'], short: ['int', 'long', 'float', 'double'], char: ['int', 'long', 'float', 'double'],
        int: ['long', 'float', 'double'], long: ['float', 'double'], float: ['double'], double: [] };
      const widens = (a, b) => a === b || (WID[a] || []).includes(b);

      // ── члены своих классов: поля (fld), методы (mth: имя → варианты), конструкторы ──
      function eraseT(t, tvb){
        if (!t) return 'Object';
        let d = 0; while (t.endsWith('[]')) { t = t.slice(0, -2); d++; }
        let b = genName(t);
        if (tvb && Object.prototype.hasOwnProperty.call(tvb, b)) b = tvb[b] ? genName(tvb[b]) : 'Object';
        else if (TVAR.test(b)) b = 'Object';
        return b.split('.').pop() + 'A'.repeat(d);
      }
      const sigKey = (ps, tvb) => ps.map(p => eraseT(p.ty, tvb)).join('$');
      function members(c){
        if (c.membersDone || c.ext) return;
        c.membersDone = true;
        const save = CUR; CUR = c;
        const d = c.d, isI = c.iface;
        c.fld = new Map(); c.mth = new Map(); c.smth = new Map(); c.inits = [];
        const addM = (ov, line) => {
          const M = ov.static ? c.smth : c.mth;
          let m = M.get(ov.name); if (!m) M.set(ov.name, m = { name: ov.name, ovs: [], cls: c });
          if (m.ovs.some(o => o.key === ov.key)) throw JErr('Метод ' + ov.name + '(' + ov.params.map(p => p.ty).join(', ') + ') уже объявлен в ' + c.name, line);
          m.ovs.push(ov);
        };
        if (c.kind === 'record') for (const cp of c.comps) c.fld.set(cp.name, { kind: 'field', name: cp.name, type: canon(cp.ty, c, cp.line, c.tps), static: false, final: true, cls: c, line: cp.line, rec: true });
        if (c.kind === 'enum') for (const k of c.consts) c.fld.set(k.name, { kind: 'field', name: k.name, type: c.q, static: true, final: true, cls: c, econst: k, line: k.line });
        for (const m of d.members) {
          if (m.m === 'field') {
            const st = m.mods.has('static') || isI || !!c.implicit, fin = m.mods.has('final') || isI;
            for (const x of m.decls) {
              if (c.fld.has(x.name)) throw JErr('Поле «' + x.name + '» уже есть в ' + c.name, x.line);
              const ty = x.ty === 'var' ? (c.implicit ? 'var' : (() => { throw JErr('var — только для переменных внутри методов; у поля напиши тип', x.line); })()) : canon(x.ty, c, x.line, c.tps);
              c.fld.set(x.name, { kind: 'field', name: x.name, type: ty, static: st, final: fin, cls: c, decl: x, line: x.line, top: !!m.top });
            }
          } else if (m.m === 'method') {
            if (m.mods.has('synchronized')) throw JErr('synchronized не поддерживается: скрипты идут в одном потоке — просто убери synchronized', m.line);
            if (m.mods.has('native')) throw JErr('native-методы не поддерживаются', m.line);
            if (skipClient(m)) continue;
            const tps = (m.tps || []).map(x => x.name), tvb = Object.fromEntries((m.tps || []).map(x => [x.name, x.bound])), all = c.tps.concat(tps);
            const params = m.params.map(p => ({ name: p.name, ty: canon(p.ty, c, p.line, all), va: p.va, line: p.line }));
            const st = m.mods.has('static') || !!c.implicit;
            const abs = !m.body && !st;
            if (abs && !isI && !m.mods.has('abstract')) throw JErr('У метода ' + m.name + ' нет тела { … } (или пометь его abstract)', m.line);
            if (abs && !c.abstract && c.kind === 'class' && !c.anon) throw JErr('Абстрактный метод ' + m.name + ' — только в abstract-классе (добавь abstract к классу ' + c.name + ')', m.line);
            if (m.body && isI && !st && !m.mods.has('default') && !m.mods.has('private')) throw JErr('Метод с телом в интерфейсе пометь default: default ' + m.ret + ' ' + m.name + '(…) { … }', m.line);
            const ov = { name: m.name, params, ret: canon(m.ret, c, m.line, all), static: st, abstract: abs, cls: c, fn: m, tps, tvb: Object.assign({}, c.tpb, tvb), line: m.line,
              va: params.length > 0 && params[params.length - 1].va, annos: m.annos || [], over: null };
            ov.key = sigKey(params, ov.tvb);
            addM(ov, m.line);
          } else if (m.m === 'ctor') {
            if (c.iface) throw JErr('У интерфейса нет конструкторов', m.line);
            const params = m.params.map(p => ({ name: p.name, ty: canon(p.ty, c, p.line, c.tps), va: p.va, line: p.line }));
            c.ctors.push({ params, fn: m, cls: c, va: params.length > 0 && params[params.length - 1].va, line: m.line, key: sigKey(params, c.tpb) });
          } else if (m.m === 'cctor') {
            if (c.cctor) throw JErr('Компактный конструктор записи — только один', m.line);
            c.cctor = m;
          } else if (m.m === 'init') c.inits.push(m);
        }
        if (c.kind === 'record') {
          const ps = c.comps.map(cp => ({ name: cp.name, ty: c.fld.get(cp.name).type, va: cp.va, line: cp.line })), key = sigKey(ps, c.tpb);
          let canonC = c.ctors.find(k => k.key === key);
          if (!canonC) { canonC = { params: ps, fn: null, cls: c, va: ps.length > 0 && ps[ps.length - 1].va, line: c.d.line, key, canonical: true }; c.ctors.push(canonC); }
          canonC.canonical = true;
          for (const cp of c.comps) if (!c.mth.has(cp.name) || !c.mth.get(cp.name).ovs.some(o => !o.params.length))
            addM({ name: cp.name, params: [], ret: c.fld.get(cp.name).type, static: false, abstract: false, cls: c, fn: null, acc: cp.name, tps: [], tvb: c.tpb, line: cp.line, key: '', va: false, annos: [] }, cp.line);
        }
        if (!c.ctors.length && !c.iface && !c.implicit) c.ctors.push({ params: [], fn: null, cls: c, va: false, line: c.d.line, key: '', dflt: true });
        for (const n of c.nested.values()) members(n);
        CUR = save;
      }
      // варианты метода name, видимые из класса c (самые «поздние» по ключу), без своих — inherited
      const OBJ_OVS = [{ name: 'equals', params: [{ name: 'o', ty: 'Object' }], ret: 'boolean', js: 'equals', key: 'Object', obj: true, static: false },
        { name: 'hashCode', params: [], ret: 'int', js: 'hashCode', key: '', obj: true, static: false }, { name: 'toString', params: [], ret: 'String', js: 'toString', key: '', obj: true, static: false }];
      // унаследованные варианты метода name (с подстановкой параметров типа: implements Comparable<Dog> → compareTo(Dog))
      function inheritedOvs(c, name, own){
        const out = [];
        const has = (k, k2) => out.some(o => o.key === k || o.key2 === k || (k2 && (o.key === k2 || o.key2 === k2)));
        const add = (ov, k2, via) => { if (has(ov.key, k2)) return; out.push(k2 && k2 !== ov.key || via ? Object.assign(Object.create(ov), { key2: k2 || ov.key, via: via || null }) : ov); };
        if (own) { members(c); const m = c.mth && c.mth.get(name); if (m) for (const ov of m.ovs) add(ov); }
        const self = c.implicit ? null : (c.tps && c.tps.length ? c.q + '<' + c.tps.join(',') + '>' : c.q);
        const anc = self ? supers(self).slice(1) : [];
        if (c.anon || c.local) { if (c.base) anc.unshift(...supers(c.base)); for (const it of c.ifaces) anc.push(...supers(it)); if (c.libBaseT) anc.push(...supers(c.libBaseT)); }
        for (const st of anc) {
          const a = userC(st);
          if (a) {
            members(a);
            const m = a.mth && a.mth.get(name);
            if (m) { const map = {}; a.tps.forEach((x, i) => map[x] = genArgs(st)[i] || null); for (const ov of m.ovs) { const k2 = a.tps.length ? sigKey(ov.params.map(p => ({ ty: subst(p.ty, map) || 'Object' })), ov.tvb) : null; add(ov, k2, a.iface ? a : null); } }
            continue;
          }
          const e = libE(st);
          if (e) for (const sg of e.m.get(name) || []) {
            const map = {}; e.tps.forEach((x, i) => map[x] = genArgs(st)[i] || null);
            const ps = sg.ps.map(p => subst(p, map));
            const key = sigKey(ps.map(ty => ({ ty: TVAR.test(ty) ? 'Object' : ty })));
            add({ name, params: ps.map((ty, i) => ({ name: 'p' + i, ty })), ret: subst(sg.ret, map), js: sg.js, key, lib: sg, libT: st, static: false, va: sg.va, abstract: e.iface && sg === e.fi, cls: null });
          }
        }
        for (const ov of OBJ_OVS) if (ov.name === name) add(ov);
        return out;
      }
      // имена методов в JS: один вариант — простое имя; перегрузки — name$ключ и «распределитель» под простым именем
      function nameMethods(c){
        if (c.named || c.ext) return;
        c.named = true;
        members(c);
        if (c.baseC) nameMethods(c.baseC);
        for (const ic of allIfaceC(c)) nameMethods(ic);
        c.pdisp = new Set(c.baseC ? (c.baseC.pdisp || []) : []);
        for (const ic of allIfaceC(c)) for (const n of ic.pdisp || []) c.pdisp.add(n);
        for (const [nm, m] of c.mth) {
          const inh = inheritedOvs(c, nm), plain = mjs(nm);
          for (const ov of m.ovs) { const h = inh.find(o => o.key === ov.key || o.key2 === ov.key); ov.over = h || null; ov.js = h ? h.js : null; if (h) ov.famKey = h.famKey || h.key; }
          const total = new Set(inh.map(o => o.key2 || o.key).concat(m.ovs.map(o => o.key))).size;
          if (total <= 1 && !c.pdisp.has(nm)) { for (const ov of m.ovs) ov.js = ov.js || plain; continue; }
          for (const ov of m.ovs) if (!ov.js || ov.js === plain) ov.js = plain + '$' + (ov.key || 'v').replace(/[^\w$]/g, '_');
          if (m.ovs.some(ov => !ov.over || ov.over.js === plain) || !c.pdisp.has(nm)) { m.disp = inh.filter(o => !m.ovs.some(x => x.key === o.key || x.key === o.key2)).concat(m.ovs); c.pdisp.add(nm); }
        }
        for (const [nm, m] of c.smth) {
          const plain = mjs(nm);
          if (m.ovs.length === 1) { m.ovs[0].js = plain; continue; }
          for (const ov of m.ovs) ov.js = plain + '$' + (ov.key || 'v').replace(/[^\w$]/g, '_');
          m.disp = m.ovs;
        }
        for (const n of c.nested.values()) nameMethods(n);
      }
      // все варианты метода, видимые у типа t (свой класс / интерфейс): свои + унаследованные
      function userOvs(c, name, wantStatic){
        nameMethods(c);
        if (wantStatic) {
          const out = [];
          for (let x = c, k = 0; x && k < 50; x = x.baseC, k++) { members(x); nameMethods(x); const m = x.smth.get(name); if (m) for (const ov of m.ovs) if (!out.some(o => o.key === ov.key)) out.push(ov); }
          for (const ic of allIfaceC(c)) { const m = ic.smth && ic.smth.get(name); if (m && c === ic) for (const ov of m.ovs) out.push(ov); }
          return out;
        }
        return inheritedOvs(c, name, true);
      }
      // поле класса c (своё или унаследованное)
      function findFld(c, name){
        for (let x = c, k = 0; x && k < 50; x = x.baseC, k++) { members(x); const f = x.fld && x.fld.get(name); if (f) return f; }
        for (const ic of allIfaceC(c)) { members(ic); const f = ic.fld && ic.fld.get(name); if (f) return f; }
        return null;
      }

      // ── области видимости и функции ──
      const push = () => { SC = { v: new Map(), t: null, up: SC, fn: FN }; };
      const pop = () => { SC = SC.up; };
      function declare(name, type, line, extra){
        for (let s = SC; s; s = s.up) {
          if (s.fn !== FN && !(s.fn && FN && FN.lambdaOf === s.fn) && !(FN && isLambdaChain(FN, s.fn))) break;
          if (s.v.has(name)) throw JErr('Переменная «' + name + '» уже объявлена' + (s.fn !== FN ? ' снаружи (в Java лямбда не может объявить такое же имя)' : ''), line);
        }
        let js = jsName(name);
        if (JSN.has(js)) js = js + '$v';
        const v = Object.assign({ type: type || null, js, name, fn: FN }, extra);
        SC.v.set(name, v);
        return v;
      }
      const isLambdaChain = (f, target) => { for (let x = f; x && x.kind === 'lambda'; x = x.up) if (x.up === target) return true; return false; };
      function lookupVar(name){ for (let s = SC; s; s = s.up) { const v = s.v.get(name); if (v) { if (s.fn !== FN && v.fnRoot !== undefined) {} return v; } } return null; }
      function declType(name, c){ if (!SC.t) SC.t = new Map(); if (SC.t.has(name)) throw JErr('Класс «' + name + '» уже объявлен здесь', c.d.line); SC.t.set(name, c); }
      // «this» нужного класса из текущей функции: this, this.$o (внутренний класс), $selfN (захвачен для анонимного класса / лямбды-генератора)
      function capture(F){
        if (!F) return null;
        if (F.self !== 'this') return F.self;
        const R = F.root || F;
        if (!R.capSelf) { R.capSelf = '$self' + (++TMP); }
        return R.capSelf;
      }
      function instExpr(target, line, quiet){
        let F = FN, c = F ? F.cls : null, e = F && !F.isStatic ? F.self : null;
        for (let k = 0; c && k < 30; k++) {
          if (e !== null && isSubC(c, target)) return e;
          if (c.inner) { e = e === null ? null : e + '.$o'; c = c.outer; continue; }
          if (c.local || c.anon) { e = c.capSelf || null; c = c.declCls; continue; }
          break;
        }
        if (quiet) return null;
        throw JErr('Здесь нет объекта ' + target.name + ' (static-контекст): нужен объект — например, new ' + target.name + '(…)', line);
      }
      const isSubC = (a, b) => { if (!a || !b) return false; for (let x = a, k = 0; x && k < 50; x = x.baseC, k++) if (x === b || (x.ext && b.ext && x.q === b.q) || (b.ext && x.q === b.q)) return true; return !!b.iface && allIfaceC(a).includes(b); };
      // ── типы значений: «неизвестно» (null, Object без сведений, параметр типа) — тогда всё решается во время работы ──
      const unk = t => !t || t === 'Object' || t === 'var' || isTVName(t) || t === 'AnyFn';
      const isRef = t => !!t && !NUMS.has(t) && t !== 'boolean' && t !== 'void';
      const shortT = t => !t ? '?' : t.replace(/\b(java\.util\.|java\.lang\.)/g, '');
      const ARR_TAG = { int: 'I', long: 'J', short: 'S', byte: 'B', char: 'C', boolean: 'Z', float: 'F', double: 'D' };
      const arrTag = et => ARR_TAG[et] || 'L';
      // ── выражения: результат { c: код, t: тип, v: значение константы, lit, isNull, lv, ty (ссылка на тип), pkg (часть имени пакета) } ──
      const NOMARK = new Set(['num', 'str', 'chr', 'bool', 'null', 'id', 'this']);
      const ex = (n, want) => { const R = raw(n, want); if (n.line && n.line !== STL && !NOMARK.has(n.k) && !R.ty && !R.pkg) R.c = mark(n.line) + R.c; return R; };
      const LEADRE = new RegExp('^(?:' + MK + '[0-9]+' + MK2 + ')+');
      const lead = (kw, c) => { const m = LEADRE.exec(c); return m ? m[0] + kw + c.slice(m[0].length) : kw + c; };
      function val(n, want){   // значение (не тип и не пакет)
        const R = ex(n, want);
        if (R.ty) throw JErr('«' + (R.ty.c ? R.ty.c.name : R.t) + '» — это тип, а не значение', n.line);
        if (R.pkg) throw JErr('Имя «' + R.pkg + '» не найдено', n.line);
        if (R.t === 'void') throw JErr('Метод ничего не возвращает (void) — его результат нельзя использовать', n.line);
        return R;
      }
      const numLit = (v, t) => t === 'long' ? String(v) + 'n' : Object.is(v, -0) ? '-0' : String(v);
      function raw(n, want){
        switch (n.k) {
          case 'num': return { c: n.nt === 'long' ? n.v + 'n' : numLit(n.v), t: n.nt, v: n.v, lit: true, pure: true };
          case 'str': return { c: JSON.stringify(n.v), t: 'String', v: n.v, lit: true, pure: true };
          case 'chr': return { c: JSON.stringify(n.v), t: 'char', v: n.v, lit: true, pure: true };
          case 'bool': return { c: String(n.v), t: 'boolean', v: n.v, lit: true, pure: true };
          case 'null': return { c: 'null', t: null, isNull: true, pure: true };
          case 'id': return rid(n.name, n.line);
          case 'this': { if (!FN || FN.isStatic || !FN.self) throw JErr('this здесь нельзя (static-метод или код вне класса)', n.line); return { c: FN.self, t: clsT(FN.cls), pure: true }; }
          case 'othis': { const c = userType(n.ty, FN && FN.cls); if (!c) throw JErr('Класс «' + n.ty + '» не найден', n.line); return { c: instExpr(c, n.line), t: clsT(c), pure: true }; }
          case 'super': throw JErr('super можно только так: super.метод(…) или super.поле', n.line);
          case 'mem': return memX(n);
          case 'call': return callX(n, want);
          case 'idx': return idxX(n);
          case 'new': return newObj(n, want);
          case 'newarr': return newArr(n);
          case 'arrinit': { if (!want || !isArrT(want)) throw JErr('Список { … } — только при объявлении массива: int[] a = { 1, 2 }; иначе new int[] { 1, 2 }', n.line); return arrLit(n, want); }
          case 'lambda': return lambdaX(n, want);
          case 'mref': return mrefX(n, want);
          case 'tyexpr': throw JErr('Тип ' + n.ty + ' здесь не к месту', n.line);
          case 'un': return unX(n);
          case 'post': return incX(n.e, n.op, false, n.line, false);
          case 'bin': return binX(n);
          case 'asg': return asgX(n, false);
          case 'cond': return condX(n, want);
          case 'cast': return castX(n);
          case 'inst': return instX(n);
          case 'swx': return swX(n, want);
          case 'clslit': { const t = canon(n.ty, FN && FN.cls, n.line); const u = userC(t); return { c: '$.cls(' + (u ? u.js : JSON.stringify(t)) + ')', t: 'Class<' + boxed(t) + '>' }; }
          case 'isuper': throw JErr(n.ty + '.super — только вызов метода: ' + n.ty + '.super.метод()', n.line);
        }
        throw JErr('Это выражение не поддерживается', n.line);
      }
      const clsT = c => !c ? null : c.implicit ? null : c.tps && c.tps.length ? c.q + '<' + c.tps.join(',') + '>' : c.q;
      // ── имена: переменная → поле (своё, внешнего класса) → import static → тип → глобальное API → пакет ──
      function rid(name, line){
        let v = lookupVar(name);
        if (v && FN && v.fn && v.fn.cls !== FN.cls && FN.cls) {   // внутри анонимного/локального класса его поля важнее переменных снаружи
          for (let c = FN.cls, k = 0; c && c !== v.fn.cls && k < 30; c = c.outer || c.declCls, k++) if (findFld(c, name)) { v = null; break; }
        }
        if (v) return { c: v.js, t: v.type, lv: !v.final, pure: true, loc: v };
        if (FN && FN.cls) {
          for (let c = FN.cls, k = 0; c && k < 30; c = c.outer || c.declCls, k++) {
            const f = findFld(c, name);
            if (f) return fieldRef(f, c, line, null);
            if ((c.libBase && c.libBase !== 'Object') || c.baseC) {
              const lf = libFld(c.q, name), self = lf ? instExpr(c, line, true) : null;
              if (lf && self) return { c: self + '.' + name, t: lf, lv: true, pure: true };
            }
          }
        }
        if (MAIN.fld && MAIN.fld.has(name)) return fieldRef(MAIN.fld.get(name), MAIN, line, null);
        { const own = SIMP.get(name) || [...SIMP.keys()].filter(k => k[0] === '*').map(k => SIMP.get(k)).find(o => staticFieldOf(o, name));
          if (own) { const r = staticFieldOf(own, name); if (r) return r; } }
        const ty = typeRefOf(name);
        if (ty) return ty;
        const g = globalRef(name, line);
        if (g) return g;
        if (/^[a-z_][\w$]*$/.test(name) && (name === 'java' || name === 'javax' || name === 'net' || name === 'com' || name === 'org' || name === 'io' || name === 'dev' || name === 'me')) return { pkg: name };
        throw Object.assign(JErr('Имя «' + name + '» не найдено (нет такой переменной, поля или класса)' + nameHint(name), line), { unk: true });
      }
      function nameHint(name){
        if (name === 'string') return ' — может, String?';
        if (name === 'True' || name === 'False') return ' — в Java true / false с маленькой буквы';
        if (name === 'console' || name === 'Console') return ' — печать: System.out.println(…)';
        if (name === 'Debug') return ' — печать: System.out.println(…) или print(…)';
        if (MODE !== 'studio' && (name === 'workspace' || name === 'script')) return ' (это API «Студии 3D»; в моде — world, player, mod)';
        if (MODE === 'studio' && MOD_G[name] && name !== 'game') return ' (это API модов; в «Студии 3D» — script, workspace, Players)';
        const all = [];
        for (let s = SC; s; s = s.up) for (const k of s.v.keys()) all.push(k);
        for (let c = FN && FN.cls, k = 0; c && k < 30; c = c.outer || c.declCls, k++) { members(c); for (let x = c, j = 0; x && j < 50; x = x.baseC, j++) if (x.fld) all.push(...x.fld.keys()); }
        if (MAIN.fld) all.push(...MAIN.fld.keys());
        all.push(...Object.keys(MODE === 'mod' ? MOD_G : STUDIO_G));
        const k = near(name, all);
        return k ? ' (может, ' + k + '?)' : '';
      }
      function fieldRef(f, ctxC, line, recv){
        if (f.static) { const oc = ownerJs(f.cls); return { c: oc + '[' + fkey(f.name) + ']', t: f.type, lv: !f.final || !!(FN && FN.initOf === f.cls), pure: true, fld: f }; }
        if (FN && FN.isStatic && !recv && !(FN.cls && FN.cls.local)) {
          const ie = instExpr(f.cls, line, true);
          if (!ie) throw JErr('Поле «' + f.name + '» — не static: в static-методе нужен объект (' + f.cls.name + ' x = …; x.' + f.name + ')', line);
        }
        const self = recv || instExpr(f.cls, line);
        return { c: self + '[' + fkey(f.name) + ']', t: fieldT(f, null), lv: !f.final || !!(FN && (FN.kind === 'ctor' || FN.kind === 'finit') && FN.cls === f.cls), pure: pureCode(self), fld: f };
      }
      // JS-имя класса; класс из другого скрипта (XC) — через $.X("Имя") (сам объект варианта метода или поля ссылается на оригинал)
      const ownerJs = c => { USEDCLS && USEDCLS.add(c); if (!c.ext && !c.local && !c.anon && !c.implicit && XC && XC.get(c.q) === c && CL.get(c.q) !== c) return imp(c).js; return c.js; };
      let USEDCLS = null;
      const fieldT = (f, recvT) => { if (!recvT || !f.cls.tps || !f.cls.tps.length) return f.type; const as = asSuper(recvT, f.cls.q), m = {}; f.cls.tps.forEach((n, i) => m[n] = as ? genArgs(as)[i] || null : null); return subst(f.type, m) || null; };
      function staticFieldOf(owner, name){
        const u = userType(owner.split('.').pop(), FN && FN.cls) || userC(owner);
        if (u) { const f = findFld(u, name); return f && f.static ? fieldRef(f, u, 0, null) : null; }
        const e = lib().get(libQ(owner) || owner);
        if (e && e.sf.has(name)) return libStaticField(e, name);
        return null;
      }
      function typeRefOf(name){
        const u = userType(name, FN && FN.cls);
        if (u) return { ty: { c: u }, c: u.js, t: u.q };
        const ln = libQ(name);
        if (ln) return { ty: { lib: ln }, c: '$A.' + jsLib(ln), t: ln };
        if (NOPE[name]) throw JErr(name + ': ' + NOPE[name], 0);
        for (const st of STARS) { /* import a.b.* — всё, что есть в библиотеке, уже видно по простому имени */ }
        return null;
      }
      const jsLib = n => n.replace(/\./g, '_');
      // глобальное API: «Студия 3D» — script, workspace, game …; мод — mod, world, player …
      function globalRef(name){
        if (MODE === 'studio' && Object.prototype.hasOwnProperty.call(STUDIO_G, name)) return { c: '$G.' + name, t: STUDIO_G[name], pure: true, g: name };
        if (MODE === 'mod' && Object.prototype.hasOwnProperty.call(MOD_G, name)) return { c: '$G.' + name, t: MOD_G[name], pure: true, g: name };
        return null;
      }
      // ── доступ к члену: obj.name ──
      function memX(n){
        const name = n.name;
        if (n.o.k === 'super') {
          const bc = FN && FN.cls && FN.cls.baseC, f = bc && findFld(bc, name);
          if (!f) throw JErr('У базового класса нет поля «' + name + '»', n.line);
          return fieldRef(f, bc, n.line, instExpr(FN.cls, n.line));
        }
        const O = n.o.k === 'id' || n.o.k === 'mem' ? raw(n.o) : val(n.o);
        if (O.pkg) {   // java.util.List → тип; net.minecraft.block.Block → тип
          const full = O.pkg + '.' + name, ty = /^[A-Z]/.test(name) ? (userType(name, FN && FN.cls) ? typeRefOf(name) : libQ(name) ? typeRefOf(name) : null) : null;
          if (ty) return ty;
          for (const [re, why] of PKG_NO) if (re.test(full)) throw JErr(full + ': ' + why, n.line);
          return { pkg: full };
        }
        if (O.ty) return staticMem(O, name, n);
        return instField(O, name, n);
      }
      function staticMem(O, name, n){
        if (O.ty.c) {
          const c = O.ty.c;
          if (name === 'length') throw JErr(c.name + '.length — у класса нет длины', n.line);
          const f = findFld(c, name);
          if (f) { if (!f.static) throw JErr('Поле «' + name + '» — не static: нужен объект ' + c.name, n.line); return fieldRef(f, c, n.line, null); }
          const nt = nestedOf(c, name); if (nt) return { ty: { c: nt }, c: nt.js, t: nt.q };
          throw JErr('У ' + c.name + ' нет static-поля «' + name + '»' + memHint(c, name), n.line);
        }
        const ln = O.ty.lib, e = lib().get(ln);
        if (lib().has(ln + '.' + name)) return { ty: { lib: ln + '.' + name }, c: '$A.' + jsLib(ln + '.' + name), t: ln + '.' + name };
        if (e && e.sf.has(name)) return libStaticField(e, name);
        if (e && e.mcAny) return { c: '$A.' + jsLib(ln) + '.' + name, t: e.mcAny, pure: true };
        if (e && (e.s.has(name) || e.m.has(name))) throw JErr(ln + '.' + name + ' — это метод: пиши ' + ln + '.' + name + '(…)', n.line);
        if (MODE === 'studio' && ln === 'Enum') return { c: '$G.Enum.' + name, t: null, pure: true };   // Enum.Material.Neon, Enum.EasingStyle.Sine — как в Roblox
        throw JErr(ln + '.' + name + ' — такого нет' + libHint(e, name), n.line);
      }
      function libStaticField(e, name){
        const t = e.sf.get(name);
        const K = { 'Integer.MAX_VALUE': '2147483647', 'Integer.MIN_VALUE': '(-2147483648)', 'Long.MAX_VALUE': '9223372036854775807n', 'Long.MIN_VALUE': '(-9223372036854775808n)',
          'Math.PI': 'Math.PI', 'Math.E': 'Math.E', 'Short.MAX_VALUE': '32767', 'Short.MIN_VALUE': '(-32768)', 'Byte.MAX_VALUE': '127', 'Byte.MIN_VALUE': '(-128)' }[e.name + '.' + name];
        if (K) return { c: K, t, pure: true, v: K.endsWith('n') || K.endsWith('n)') ? null : Number(K.replace(/[()]/g, '')) };
        if (e.world && e.name !== 'Vector3' && e.name !== 'CFrame') return { c: '$G.' + e.name + '.' + name, t, pure: true };   // Players.PlayerAdded, RunService.Heartbeat — объекты мира
        return { c: '$A.' + jsLib(e.name) + '.' + name, t, pure: true };
      }
      const libHint = (e, name) => { if (!e) return ''; const all = [...e.s.keys(), ...e.sf.keys(), ...e.m.keys(), ...e.f.keys()]; for (const x of e.ext || []) { const se = libE(x); if (se) all.push(...se.m.keys(), ...se.f.keys()); } const k = near(name, all); return k ? ' (может, ' + k + '?)' : ''; };
      const memHint = (c, name) => { const all = [...(c.fld || new Map()).keys(), ...(c.mth || new Map()).keys(), ...(c.smth || new Map()).keys()]; const k = near(name, all); return k ? ' (может, ' + k + '?)' : ''; };
      // поле библиотечного предка (Script.Parent, script, enabled) — тип или null
      function libFld(t, name){
        for (const s of supers(t)) { const se = libE(s); if (se && se.f.has(name)) { const map = {}; se.tps.forEach((x, i) => map[x] = genArgs(s)[i] || null); return subst(se.f.get(name), map) || 'Object'; } }
        return null;
      }
      function instField(O, name, n){
        const t = O.t;
        if (t && isArrT(t)) { if (name === 'length') return { c: O.c + '.length', t: 'int' }; throw JErr('У массива есть только length (длина), а не «' + name + '»', n.line); }
        if (name === 'length' && (t === 'String' || t === 'StringBuilder')) throw JErr('Длина строки — метод: s.length()', n.line);
        const u = userC(t);
        if (u) {
          const f = findFld(u, name);
          if (!f) { const lf = libFld(t, name); if (lf) return { c: O.c + '.' + name, t: lf, lv: true, pure: O.pure }; }
          if (!f) throw JErr('У ' + u.name + ' нет поля «' + name + '»' + memHint(u, name) + (u.mth && (u.mth.has(name)) ? ' — это метод: ' + name + '()' : ''), n.line);
          if (f.static) return fieldRef(f, u, n.line, null);
          return { c: O.c + '[' + fkey(name) + ']', t: fieldT(f, t), lv: !f.final || !!(FN && FN.kind === 'ctor' && FN.cls === f.cls), pure: O.pure, fld: f };
        }
        const e = libE(t);
        if (e) {
          for (const s of supers(t)) { const se = libE(s); if (se && se.f.has(name)) { const map = {}; se.tps.forEach((x, i) => map[x] = genArgs(s)[i] || null); return { c: O.c + '.' + name, t: subst(se.f.get(name), map) || null, lv: true, pure: O.pure }; } }
          if (e.sf.has(name)) return libStaticField(e, name);
          if (e.mcAny) return { c: O.c + '.' + name, t: e.mcAny, lv: true };
          if (!unk(t) && !e.dyn) throw JErr('У ' + shortT(t) + ' нет поля «' + name + '»' + libHint(e, name) + ((e.m.has(name)) ? ' — это метод: ' + name + '()' : ''), n.line);
        }
        if (t && !unk(t) && (NUMS.has(t) || t === 'boolean')) throw JErr('У ' + t + ' нет полей (это простое значение)', n.line);
        return { c: '$.gf(' + O.c + ', ' + JSON.stringify(name) + ')', t: null, lv: true, dyn: { o: O.c, name } };
      }
      // ── индекс массива: a[i] ──
      function idxX(n){
        const O = val(n.o), I = val(n.i);
        if (O.t && !isArrT(O.t) && !unk(O.t)) throw JErr('[ ] — только у массива, а здесь ' + shortT(O.t) + (O.t === 'String' ? ' (символ строки — s.charAt(i))' : /List|Map/.test(O.t) ? ' (элемент — list.get(i), map.get(key))' : ''), n.line);
        const ic = intIdx(I, n.line);
        return { c: '$.ag(' + O.c + ', ' + ic + ')', t: O.t && isArrT(O.t) ? arrElem(O.t) : null };
      }
      function intIdx(I, line){
        const t = prim(I.t);
        if (t === 'long') throw JErr('Индекс массива — int, а здесь long (нужно (int) …)', line);
        if (t === 'double' || t === 'float') throw JErr('Индекс массива — целое число (int), а здесь ' + t, line);
        if (t === 'boolean' || I.t === 'String') throw JErr('Индекс массива — целое число (int)', line);
        return conv(I, 'int', line, 'call');
      }
      // ── преобразования типов (присваивание, аргумент, явное приведение) ──
      function conv(R, to, line, mode){
        const from = R.t;
        if (!to || to === 'var' || to === 'void') return R.c;
        if (R.isNull) { if (NUMS.has(to) || to === 'boolean') throw JErr('null нельзя положить в ' + to + ' (простой тип)', line); return R.c; }
        if (from === to) return R.c;
        const pf = prim(from), pt = prim(to);
        if (NUMS.has(pt) && !UNBOX[to]) {   // в простое число
          if (NUMS.has(pf)) { const c = UNBOX[from] ? '$.ub(' + R.c + ')' : R.c; return numConv({ c, v: UNBOX[from] ? undefined : R.v, lit: R.lit }, pf, pt, line, mode, !!UNBOX[from]); }
          if (unk(from) || from === 'Number' || genName(from) === 'Comparable') return '$.toNum(' + R.c + ', ' + JSON.stringify(pt) + ')';
          throw JErr('Несовместимые типы: ' + shortT(from) + ' нельзя превратить в ' + to + convHint(from, to), line);
        }
        if (to === 'boolean') {
          if (pf === 'boolean') return UNBOX[from] ? '$.ub(' + R.c + ')' : R.c;
          if (unk(from)) return '$.toBool(' + R.c + ')';
          throw JErr('Несовместимые типы: ' + shortT(from) + ' — не boolean (true/false)' + (NUMS.has(pf) ? ' — может, нужно сравнение (x != 0)?' : ''), line);
        }
        if (UNBOX[to]) {   // упаковка: int → Integer (и мягко: int → Long, Double); char → Character — объект (чтобы отличать от String)
          if (to === 'Character' && pf === 'char') return UNBOX[from] ? R.c : '$.bc(' + R.c + ')';
          if (to === 'Character' && NUMS.has(pf)) return '$.bc(' + numConv({ c: UNBOX[from] ? '$.ub(' + R.c + ')' : R.c, v: R.v, lit: R.lit }, pf, 'char', line, mode === 'cast' ? 'cast' : 'asg', false) + ')';
          if (NUMS.has(pf)) return numConv({ c: UNBOX[from] ? '$.ub(' + R.c + ')' : R.c, v: R.v, lit: R.lit }, pf, pt, line, mode === 'cast' ? 'cast' : 'box', false);
          if (pf === 'boolean' && to === 'Boolean') return R.c;
          if (unk(from)) return R.c;
          throw JErr('Несовместимые типы: ' + shortT(from) + ' нельзя превратить в ' + to + convHint(from, to), line);
        }
        if (to === 'String') {
          if (unk(from) || from === 'String' || genName(from) === 'CharSequence') return R.c;
          throw JErr('Несовместимые типы: ' + shortT(from) + ' — не String' + convHint(from, to), line);
        }
        if (NUMS.has(from) || from === 'boolean') {
          if (unk(to) || to === 'Number' || genName(to) === 'Comparable' || to === 'Serializable' || assignable(boxed(from), to)) return from === 'char' ? '$.bc(' + R.c + ')' : R.c;
          throw JErr('Несовместимые типы: ' + from + ' нельзя превратить в ' + shortT(to), line);
        }
        if (mode !== 'cast' && from && to && !unk(from) && !unk(to) && !assignable(from, to) && !(genName(from) === genName(to))) {
          if (userC(from) || userC(to) || (libE(from) && libE(to) && !libE(from).dyn && !libE(to).dyn)) throw JErr('Несовместимые типы: ' + shortT(from) + ' нельзя положить в ' + shortT(to), line);
        }
        return R.c;
      }
      function convHint(from, to){
        if (from === 'String' && NUMS.has(prim(to))) return ' (число из строки — Integer.parseInt(s) или Double.parseDouble(s))';
        if (to === 'String') return ' (в строку — String.valueOf(x) или "" + x)';
        if (from === 'char' && to === 'String') return ' (символ в строку — String.valueOf(c))';
        return '';
      }
      // числовое преобразование: f → t (widening всегда; narrowing — при явном приведении или константе в byte/short/char)
      function numConv(R, f, t, line, mode, fromBox){
        const c = R.c, lit = R.lit && R.v !== undefined && R.v !== null;
        if (f === t) return c;
        if (!widens(f, t)) {
          const constOk = lit && f === 'int' && (t === 'byte' || t === 'short' || t === 'char') && fitsIn(R.v, t);
          const softBox = mode === 'box' && (isIntegral(f) && isIntegral(t) || (isIntegral(f) || f === 'float') && (t === 'double' || t === 'float'));
          if (mode !== 'cast' && mode !== 'cmp' && !constOk && !softBox) {
            if (f === 'double' && t === 'float') throw JErr('Возможна потеря точности: double → float' + (lit ? ' (у float-числа нужна буква f: ' + R.v + 'f)' : ' (нужно (float) …)'), line);
            throw JErr('Возможна потеря точности: ' + f + ' → ' + t + ' (нужно явное приведение: (' + t + ') …)', line);
          }
        }
        // значение
        if (f === 'char') {
          const o = lit ? String(R.v.charCodeAt(0)) : '$.ord(' + c + ')';
          return numConv({ c: o, v: lit ? R.v.charCodeAt(0) : undefined, lit }, 'int', t, line, 'cast');
        }
        if (t === 'char') {
          if (f === 'long') return '$.chr(Number(BigInt.asUintN(16, ' + c + ')))';
          if (f === 'double' || f === 'float') return '$.chr($.d2i(' + c + '))';
          return lit ? JSON.stringify(CH(R.v & 0xFFFF)) : '$.chr(' + c + ')';
        }
        if (f === 'long') {
          if (t === 'int') return '$.l2i(' + c + ')';
          if (t === 'short') return '($.l2i(' + c + ') << 16 >> 16)';
          if (t === 'byte') return '($.l2i(' + c + ') << 24 >> 24)';
          if (t === 'float') return 'Math.fround(Number(' + c + '))';
          return 'Number(' + c + ')';
        }
        if (f === 'double' || f === 'float') {
          if (t === 'double') return c;
          if (t === 'float') return lit ? String(Math.fround(R.v)) : 'Math.fround(' + c + ')';
          if (t === 'long') return '$.d2l(' + c + ')';
          if (t === 'int') return '$.d2i(' + c + ')';
          if (t === 'short') return '($.d2i(' + c + ') << 16 >> 16)';
          if (t === 'byte') return '($.d2i(' + c + ') << 24 >> 24)';
        }
        // f — int, short, byte
        if (t === 'long') return lit ? R.v + 'n' : 'BigInt(' + c + ')';
        if (t === 'float') return lit ? String(Math.fround(R.v)) : 'Math.fround(' + c + ')';
        if (t === 'double' || t === 'int') return c;
        if (t === 'short') return lit ? String((R.v << 16) >> 16) : '(' + c + ' << 16 >> 16)';
        if (t === 'byte') return lit ? String((R.v << 24) >> 24) : '(' + c + ' << 24 >> 24)';
        return c;
      }
      const fitsIn = (v, t) => t === 'byte' ? v >= -128 && v <= 127 : t === 'short' ? v >= -32768 && v <= 32767 : t === 'char' ? v >= 0 && v <= 65535 : true;
      // значение → строка как в Java (String.valueOf): double 5 → "5.0", float, char, null → "null"
      function strOf(R){
        const t = prim(R.t);
        if (R.isNull) return '"null"';
        if (R.t === 'String') return R.lit || R.nn ? R.c : '$.sn(' + R.c + ')';
        if (t === 'double') return R.lit ? JSON.stringify(dstr(R.v)) : '$.ds(' + R.c + ')';
        if (t === 'float') return R.lit ? JSON.stringify(fstr(R.v)) : '$.fs(' + R.c + ')';
        if (UNBOX[R.t]) return '$.str(' + R.c + ')';
        if (t === 'int' || t === 'short' || t === 'byte' || t === 'long' || t === 'boolean') return R.lit ? JSON.stringify(String(R.v)) : 'String(' + R.c + ')';
        if (t === 'char') return R.c;
        return '$.str(' + R.c + ')';
      }
      // ── операторы ──
      function condCode(n){
        const R = val(n), t = prim(R.t);
        if (R.t && t !== 'boolean' && !unk(R.t)) throw JErr('Условие должно быть boolean (true/false), а здесь ' + shortT(R.t) + (n.k === 'asg' ? ' — может, нужно == вместо =?' : NUMS.has(t) ? ' — может, нужно сравнение (x > 0, x != 0)?' : ''), n.line);
        return UNBOX[R.t] ? '$.ub(' + R.c + ')' : R.c;
      }
      const toT = (R, T, line) => numConv({ c: UNBOX[R.t] ? '$.ub(' + R.c + ')' : R.c, v: UNBOX[R.t] ? undefined : R.v, lit: R.lit && !UNBOX[R.t] }, prim(R.t), T, line, 'cast');
      function binX(n){
        const op = n.op;
        if (op === '&&' || op === '||') return { c: '(' + condCode(n.l) + ' ' + op + ' ' + condCode(n.r) + ')', t: 'boolean' };
        // длинные цепочки "a" + b + c … — без глубокой рекурсии по левой ветке
        if (op === '+') {
          const chain = []; let x = n;
          while (x.k === 'bin' && x.op === '+' && !x.paren) { chain.push(x); x = x.l; }
          if (chain.length > 8) { let L = val(x); for (let i = chain.length - 1; i >= 0; i--) L = binCode('+', L, val(chain[i].r), chain[i].line); return L; }
        }
        return binCode(op, val(n.l), val(n.r), n.line);
      }
      const isStrT = t => t === 'String';
      function binCode(op, L, R, line){
        const lt = L.t, rt = R.t, pl = prim(lt), pr = prim(rt);
        const ln = NUMS.has(pl), rn = NUMS.has(pr);
        if (op === '+' && (isStrT(lt) || isStrT(rt) || (L.isNull && isStrT(rt)) || (R.isNull && isStrT(lt)))) {
          const v = L.v !== undefined && R.v !== undefined && L.lit && R.lit ? constStr(L) + constStr(R) : undefined;
          if (v !== undefined) return { c: JSON.stringify(v), t: 'String', v, lit: true, nn: true };
          return { c: '(' + strOf(L) + ' + ' + strOf(R) + ')', t: 'String', nn: true };
        }
        switch (op) {
          case '+': case '-': case '*': case '/': case '%': {
            if (ln && rn) return arith(op, L, R, promo(pl, pr), line);
            if (pl === 'boolean' || pr === 'boolean') throw JErr('Арифметика (' + op + ') с boolean нельзя', line);
            if (isStrT(lt) || isStrT(rt)) throw JErr('Со строками работает только + (склейка), а здесь ' + op, line);
            if ((ln || unk(lt) || UNBOX[lt]) && (rn || unk(rt) || UNBOX[rt])) return { c: '$.dop(' + JSON.stringify(op) + ', ' + L.c + ', ' + R.c + ')', t: ln ? promoUnk(pl) : rn ? promoUnk(pr) : null };
            throw JErr('Оператор ' + op + ' не подходит для ' + shortT(lt) + ' и ' + shortT(rt), line);
          }
          case '<<': case '>>': case '>>>': {
            if ((!ln && !unk(lt)) || (!rn && !unk(rt)) || pl === 'float' || pl === 'double' || pr === 'float' || pr === 'double') throw JErr('Сдвиг ' + op + ' — только для целых чисел', line);
            if (!ln || !rn) return { c: '$.dop(' + JSON.stringify(op) + ', ' + L.c + ', ' + R.c + ')', t: null };
            const sh = pr === 'long' ? 'Number(BigInt.asIntN(32, ' + R.c + '))' : toT(R, 'int', line);
            if (pl === 'long') return { c: '$.' + (op === '<<' ? 'lshl' : op === '>>' ? 'lshr' : 'lushr') + '(' + L.c + ', ' + sh + ')', t: 'long' };
            const a = toT(L, 'int', line);
            return { c: op === '>>>' ? '(' + a + ' >>> ' + sh + ' | 0)' : '(' + a + ' ' + op + ' ' + sh + ')', t: 'int' };
          }
          case '&': case '|': case '^': {
            if (pl === 'boolean' && pr === 'boolean') { const a = UNBOX[lt] ? '$.ub(' + L.c + ')' : L.c, b = UNBOX[rt] ? '$.ub(' + R.c + ')' : R.c; return { c: op === '^' ? '(' + a + ' !== ' + b + ')' : '!!(' + a + ' ' + op + ' ' + b + ')', t: 'boolean' }; }
            if (ln && rn) {
              if (pl === 'float' || pl === 'double' || pr === 'float' || pr === 'double') throw JErr('Оператор ' + op + ' — для целых чисел и boolean', line);
              const T = promo(pl, pr), a = toT(L, T, line), b = toT(R, T, line);
              return { c: '(' + a + ' ' + op + ' ' + b + ')', t: T };
            }
            if ((ln || unk(lt)) && (rn || unk(rt))) return { c: '$.dop(' + JSON.stringify(op) + ', ' + L.c + ', ' + R.c + ')', t: null };
            if (pl === 'boolean' || pr === 'boolean') return { c: op === '^' ? '(' + L.c + ' !== ' + R.c + ')' : '!!(' + L.c + ' ' + op + ' ' + R.c + ')', t: 'boolean' };
            throw JErr('Оператор ' + op + ' не подходит для ' + shortT(lt) + ' и ' + shortT(rt), line);
          }
          case '==': case '!=': return eqCode(op, L, R, line);
          case '<': case '>': case '<=': case '>=': {
            if (ln && rn) {
              if (pl === 'char' && pr === 'char') return { c: '(' + (UNBOX[lt] ? '$.ub(' + L.c + ')' : L.c) + ' ' + op + ' ' + (UNBOX[rt] ? '$.ub(' + R.c + ')' : R.c) + ')', t: 'boolean' };
              const T = promo(pl, pr);
              return { c: '(' + toT(L, T, line) + ' ' + op + ' ' + toT(R, T, line) + ')', t: 'boolean' };
            }
            if (isStrT(lt) || isStrT(rt)) throw JErr('Строки так не сравнивают (' + op + '): пиши a.compareTo(b) ' + op + ' 0', line);
            if (pl === 'boolean' || pr === 'boolean') throw JErr('Оператор ' + op + ' не подходит для boolean', line);
            if ((ln || unk(lt)) && (rn || unk(rt))) return { c: '$.dop(' + JSON.stringify(op) + ', ' + L.c + ', ' + R.c + ')', t: 'boolean' };
            throw JErr('Оператор ' + op + ' не подходит для ' + shortT(lt) + ' и ' + shortT(rt), line);
          }
        }
        throw JErr('Оператор ' + op + ' не поддерживается', line);
      }
      const promoUnk = p => p === 'double' || p === 'float' || p === 'long' ? p : null;
      const constStr = R => R.t === 'double' ? dstr(R.v) : R.t === 'float' ? fstr(R.v) : String(R.v);
      function arith(op, L, R, T, line){
        if (L.lit && R.lit && L.v !== undefined && R.v !== undefined && L.v !== null && R.v !== null) {   // константы — сразу
          const f = foldArith(op, cval(L, T), cval(R, T), T);
          if (f !== undefined) return { c: T === 'long' ? f + 'n' : Object.is(f, -0) ? '(-0)' : (f < 0 ? '(' + numLit(f) + ')' : numLit(f)), t: T, v: f, lit: true };
        }
        const a = toT(L, T, line), b = toT(R, T, line);
        switch (T) {
          case 'int':
            if (op === '+' || op === '-') return { c: '(' + a + ' ' + op + ' ' + b + ' | 0)', t: 'int' };
            if (op === '*') return { c: 'Math.imul(' + a + ', ' + b + ')', t: 'int' };
            return { c: '$.' + (op === '/' ? 'idiv' : 'imod') + '(' + a + ', ' + b + ')', t: 'int' };
          case 'long':
            if (op === '/' || op === '%') return { c: '$.' + (op === '/' ? 'ldiv' : 'lmod') + '(' + a + ', ' + b + ')', t: 'long' };
            return { c: 'BigInt.asIntN(64, ' + a + ' ' + op + ' ' + b + ')', t: 'long' };
          case 'float': return { c: 'Math.fround(' + a + ' ' + op + ' ' + b + ')', t: 'float' };
          default: return { c: '(' + a + ' ' + op + ' ' + b + ')', t: 'double' };
        }
      }
      const cval = (R, T) => { let v = R.v; if (typeof v === 'string') v = v.charCodeAt(0); if (T === 'long') return typeof v === 'bigint' ? v : BigInt(v); return typeof v === 'bigint' ? Number(v) : v; };
      function foldArith(op, a, b, T){
        try {
          if (T === 'int') { if ((op === '/' || op === '%') && b === 0) return undefined; return op === '+' ? (a + b) | 0 : op === '-' ? (a - b) | 0 : op === '*' ? Math.imul(a, b) : op === '/' ? (a / b) | 0 : (a % b) | 0; }
          if (T === 'long') { if ((op === '/' || op === '%') && b === 0n) return undefined; return BigInt.asIntN(64, op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : a % b); }
          const r = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : a % b;
          return T === 'float' ? Math.fround(r) : r;
        } catch (e) { return undefined; }
      }
      function eqCode(op, L, R, line){
        const neg = op === '!=';
        if (L.isNull || R.isNull) {
          const X = L.isNull ? R : L;
          if (NUMS.has(X.t) || X.t === 'boolean') throw JErr('Простое значение (' + X.t + ') не бывает null', line);
          return { c: '(' + X.c + (neg ? ' != null)' : ' == null)'), t: 'boolean' };
        }
        const lt = L.t, rt = R.t, pl = prim(lt), pr = prim(rt);
        const ln = NUMS.has(pl), rn = NUMS.has(pr);
        if (ln && rn) {
          if (pl === 'char' && pr === 'char') return { c: '(' + (UNBOX[lt] ? '$.ub(' + L.c + ')' : L.c) + (neg ? ' !== ' : ' === ') + (UNBOX[rt] ? '$.ub(' + R.c + ')' : R.c) + ')', t: 'boolean' };
          const T = promo(pl, pr);
          return { c: '(' + toT(L, T, line) + (neg ? ' !== ' : ' === ') + toT(R, T, line) + ')', t: 'boolean' };
        }
        if (pl === 'boolean' && pr === 'boolean') return { c: '(' + L.c + (neg ? ' !== ' : ' === ') + R.c + ')', t: 'boolean' };
        if ((ln || pl === 'boolean') && !unk(rt) && !rn && pr !== 'boolean') throw JErr('Нельзя сравнить ' + shortT(lt) + ' и ' + shortT(rt), line);
        if ((rn || pr === 'boolean') && !unk(lt) && !ln && pl !== 'boolean') throw JErr('Нельзя сравнить ' + shortT(lt) + ' и ' + shortT(rt), line);
        if (ln || rn || unk(lt) || unk(rt)) return { c: (neg ? '!' : '') + '$.jeq(' + L.c + ', ' + R.c + ')', t: 'boolean' };
        return { c: '(' + L.c + (neg ? ' !== ' : ' === ') + R.c + ')', t: 'boolean' };
      }
      function unX(n){
        const op = n.op;
        if (op === '++' || op === '--') return incX(n.e, op, true, n.line, false);
        const R = val(n.e), t = prim(R.t);
        if (op === '!') { if (R.t && t !== 'boolean' && !unk(R.t)) throw JErr('! (не) — только для boolean', n.line); return { c: '!' + (UNBOX[R.t] ? '$.ub(' + R.c + ')' : R.c), t: 'boolean' }; }
        if (R.t && !NUMS.has(t) && !unk(R.t)) throw JErr('Оператор ' + op + ' — только для чисел', n.line);
        if (!NUMS.has(t)) return { c: op === '-' ? '$.dop("-", 0, ' + R.c + ')' : op === '~' ? '(~' + R.c + ')' : R.c, t: null };
        const T = t === 'long' ? 'long' : t === 'double' || t === 'float' ? t : 'int';
        const a = toT(R, T, n.line);
        if (op === '+') return { c: a, t: T, v: R.v !== undefined && R.lit ? cval(R, T) : undefined, lit: R.lit };
        if (op === '-') {
          if (R.lit && R.v !== undefined) { const v = cval(R, T), f = T === 'long' ? BigInt.asIntN(64, -v) : T === 'int' ? (-v) | 0 : -v; return { c: T === 'long' ? '(' + f + 'n)' : '(' + numLit(f) + ')', t: T, v: f, lit: true }; }
          return { c: T === 'int' ? '(-' + a + ' | 0)' : T === 'long' ? 'BigInt.asIntN(64, -' + a + ')' : '(-' + a + ')', t: T };
        }
        if (T === 'float' || T === 'double') throw JErr('~ — только для целых чисел', n.line);
        return { c: '(~' + a + ')', t: T };
      }
      // ++ / -- (prefix — новое значение, postfix — старое); stmt — значение не нужно
      function incX(e, op, prefix, line, stmt){
        const pre = [], L = lval(e, pre), t = prim(L.t), s = op[0];
        if (L.t && !NUMS.has(t) && !unk(L.t)) throw JErr(op + ' — только для чисел (а здесь ' + shortT(L.t) + ')', line);
        const step = g => {
          if (UNBOX[L.t]) g = '$.ub(' + g + ')';
          switch (t) {
            case 'int': return '(' + g + ' ' + s + ' 1 | 0)';
            case 'short': return '((' + g + ' ' + s + ' 1) << 16 >> 16)';
            case 'byte': return '((' + g + ' ' + s + ' 1) << 24 >> 24)';
            case 'char': return '$.chr($.ord(' + g + ') ' + s + ' 1)';
            case 'long': return 'BigInt.asIntN(64, ' + g + ' ' + s + ' 1n)';
            case 'float': return 'Math.fround(' + g + ' ' + s + ' 1)';
            case 'double': return '(' + g + ' ' + s + ' 1)';
          }
          return '$.dop(' + JSON.stringify(s) + ', ' + g + ', 1)';
        };
        if (prefix || stmt) return { c: seq(pre, L.set(step(L.get))), t: L.t };
        const old = tmp(); pre.push(old + ' = ' + L.get);
        return { c: seq(pre, '(' + L.set(step(old)) + ', ' + old + ')'), t: L.t };
      }
      // то, чему можно присвоить: { get, set(v), t }
      function lval(e, pre){
        if (e.paren) return lval(Object.assign({}, e, { paren: false }), pre);
        if (e.k === 'id') {
          const R = rid(e.name, e.line);
          if (R.ty || R.pkg) throw JErr('«' + e.name + '» — не переменная', e.line);
          if (R.loc && R.loc.final && R.loc.inited !== false) throw JErr('Переменная «' + e.name + '» объявлена final — её нельзя менять', e.line);
          if (R.loc && R.loc.fe) throw JErr('Переменную цикла «' + e.name + '» здесь лучше не менять (это копия элемента)', e.line);
          if (R.loc && R.loc.fn && FN && R.loc.fn !== FN && !R.loc.top) throw JErr('Лямбда (или анонимный класс) не может менять переменную «' + e.name + '» снаружи — в Java она должна быть effectively final. Сделай её полем класса (или массивом из одного элемента)', e.line);
          if (R.fld && R.lv === false) throw JErr('Поле «' + e.name + '» — final: менять можно только в конструкторе', e.line);
          return { get: R.c, set: v => R.c + ' = ' + v, t: R.t };
        }
        if (e.k === 'mem') {
          if (e.o.k === 'super') { const R = memX(e); return { get: R.c, set: v => R.c + ' = ' + v, t: R.t }; }
          const O = e.o.k === 'id' || e.o.k === 'mem' ? raw(e.o) : val(e.o);
          if (O.pkg) throw JErr('«' + O.pkg + '.' + e.name + '» не найдено', e.line);
          if (O.ty) { const R = staticMem(O, e.name, e); if (!R.lv && R.fld) throw JErr('Поле «' + e.name + '» — final', e.line); if (!R.fld && !R.lv) throw JErr('«' + e.name + '» менять нельзя', e.line); return { get: R.c, set: v => R.c + ' = ' + v, t: R.t }; }
          if (O.t && isArrT(O.t) && e.name === 'length') throw JErr('Длину массива менять нельзя (создай новый: Arrays.copyOf(a, n))', e.line);
          const oc = once(O.c, pre);
          const R = instField(Object.assign({}, O, { c: oc }), e.name, e);
          if (R.fld && R.lv === false) throw JErr('Поле «' + e.name + '» — final: менять можно только в конструкторе', e.line);
          if (R.dyn) return { get: R.c, set: v => '$.sf(' + oc + ', ' + JSON.stringify(e.name) + ', ' + v + ')', t: null };
          return { get: R.c, set: v => R.c + ' = ' + (R.t === null || unk(R.t) || R.fld ? v : jsArg(v, R.t)), t: R.t };
        }
        if (e.k === 'idx') {
          const O = val(e.o);
          if (O.t && !isArrT(O.t) && !unk(O.t)) throw JErr('[ ] — только у массива' + (/List|Map/.test(O.t) ? ' (элемент списка меняют так: list.set(i, x))' : ''), e.line);
          const oc = once(O.c, pre), ic = once(intIdx(val(e.i), e.line), pre);
          return { get: '$.ag(' + oc + ', ' + ic + ')', set: v => '$.ap(' + oc + ', ' + ic + ', ' + v + ')', t: O.t && isArrT(O.t) ? arrElem(O.t) : null };
        }
        throw JErr('Сюда нельзя присвоить значение', e.line);
      }
      const jsArg = (c, t) => c;
      function asgX(n){
        const op = n.op, pre = [], L = lval(n.l, pre);
        if (op === '=') {
          const R = val(n.r, L.t);
          return { c: seq(pre, L.set(conv(R, L.t, n.line, 'asg'))), t: L.t };
        }
        const bop = op.slice(0, -1);
        const R = val(n.r);
        if (L.t === 'String') {
          if (bop !== '+') throw JErr('Со строкой работает только += (склейка)', n.line);
          return { c: seq(pre, L.set('(' + strOf({ c: L.get, t: 'String' }) + ' + ' + strOf(R) + ')')), t: 'String' };
        }
        const res = binCode(bop, { c: L.get, t: L.t }, R, n.line);
        return { c: seq(pre, L.set(L.t ? conv(res, L.t, n.line, 'cast') : res.c)), t: L.t };
      }
      function condX(n, want){
        const C = condCode(n.c);
        const A = val(n.a, want), B = val(n.b, want || (A.isNull ? null : A.t));
        const pa = prim(A.t), pb = prim(B.t);
        let t;
        if (A.isNull) t = B.t && (NUMS.has(B.t) || B.t === 'boolean') ? boxed(B.t) : B.t;
        else if (B.isNull) t = A.t && (NUMS.has(A.t) || A.t === 'boolean') ? boxed(A.t) : A.t;
        else if (NUMS.has(pa) && NUMS.has(pb)) {
          if (pa === pb) t = pa;
          else if (pa === 'char' && pb === 'int' && B.lit && fitsIn(B.v, 'char')) t = 'char';
          else if (pb === 'char' && pa === 'int' && A.lit && fitsIn(A.v, 'char')) t = 'char';
          else t = promo(pa, pb);
        }
        else if (A.t === B.t) t = A.t;
        else if (pa === 'boolean' && pb === 'boolean') t = 'boolean';
        else if (unk(A.t) || unk(B.t)) t = want || null;
        else if (assignable(A.t, B.t)) t = B.t;
        else if (assignable(B.t, A.t)) t = A.t;
        else t = want || 'Object';
        const ca = t && NUMS.has(t) ? toT(A, t, n.line) : A.c, cb = t && NUMS.has(t) ? toT(B, t, n.line) : B.c;
        return { c: '(' + C + ' ? ' + ca + ' : ' + cb + ')', t };
      }
      function castX(n){
        const to = canon(n.ty, FN && FN.cls, n.line);
        if (n.e.k === 'lambda') return lambdaX(n.e, to);
        if (n.e.k === 'mref') return mrefX(n.e, to);
        const R = val(n.e, to), from = R.t;
        if (NUMS.has(to)) {
          if (NUMS.has(prim(from))) {
            const lit = R.lit && !UNBOX[from] && R.v !== undefined;
            const c = numConv({ c: UNBOX[from] ? '$.ub(' + R.c + ')' : R.c, v: R.v, lit }, prim(from), to, n.line, 'cast');
            return { c, t: to, v: lit ? foldCast(cval(R, prim(from) === 'long' ? 'long' : 'double'), prim(from), to) : undefined, lit };
          }
          if (unk(from) || from === 'Number') return { c: '$.toNum(' + R.c + ', ' + JSON.stringify(to) + ')', t: to };
          throw JErr('Нельзя привести ' + shortT(from) + ' к ' + to + convHint(from, to), n.line);
        }
        if (to === 'boolean') { if (prim(from) === 'boolean') return { c: UNBOX[from] ? '$.ub(' + R.c + ')' : R.c, t: to }; if (unk(from)) return { c: '$.toBool(' + R.c + ')', t: to }; throw JErr('Нельзя привести ' + shortT(from) + ' к boolean', n.line); }
        if (UNBOX[to]) {
          if (NUMS.has(prim(from))) return { c: numConv({ c: UNBOX[from] ? R.c : R.c, v: R.v, lit: R.lit }, prim(from), prim(to), n.line, 'cast'), t: to };
          if (prim(from) === 'boolean' && to === 'Boolean') return { c: R.c, t: to };
          if (unk(from) || from === 'Number' || genName(from) === 'Comparable') return { c: '$.cast(' + R.c + ', ' + JSON.stringify(to) + ')', t: to };
          throw JErr('Нельзя привести ' + shortT(from) + ' к ' + to + convHint(from, to), n.line);
        }
        if (NUMS.has(from) || from === 'boolean') { if (unk(to) || to === 'Number' || genName(to) === 'Comparable') return { c: R.c, t: to }; throw JErr('Нельзя привести ' + from + ' к ' + shortT(to), n.line); }
        if (to === 'String') { if (from === 'String') return R; if (unk(from) || genName(from) === 'CharSequence' || genName(from) === 'Comparable') return { c: '$.cast(' + R.c + ', "String")', t: 'String' }; throw JErr('Нельзя привести ' + shortT(from) + ' к String' + convHint(from, 'String'), n.line); }
        const u = userC(to);
        if (u) {
          const fu = userC(from);
          if (fu && !u.iface && !fu.iface && !isSubC(fu, u) && !isSubC(u, fu)) throw JErr('Нельзя привести ' + fu.name + ' к ' + u.name + ': классы не связаны наследованием', n.line);
          return { c: '$.cast(' + R.c + ', ' + u.js + ')', t: to };
        }
        if (isArrT(to)) return { c: '$.cast(' + R.c + ', ' + JSON.stringify('[' + arrTag(arrElem(to))) + ')', t: to };
        const g = genName(to);
        if (['List', 'ArrayList', 'Map', 'HashMap', 'Set', 'HashSet', 'Collection', 'Iterable', 'Number', 'Integer'].includes(g) || EXC_LIST.some(x => x[0] === g)) return { c: '$.cast(' + R.c + ', ' + JSON.stringify(g) + ')', t: to };
        return { c: R.c, t: to };
      }
      function foldCast(v, f, t){
        if (typeof v === 'bigint') { if (t === 'long') return v; const i = Number(BigInt.asIntN(32, v)); return t === 'int' ? i : t === 'short' ? (i << 16) >> 16 : t === 'byte' ? (i << 24) >> 24 : t === 'char' ? CH(i & 0xFFFF) : Number(v); }
        if (t === 'double') return v; if (t === 'float') return Math.fround(v);
        if (t === 'long') return v !== v ? 0n : v >= 9223372036854775807 ? 9223372036854775807n : v <= -9223372036854775808 ? -9223372036854775808n : BigInt(Math.trunc(v));
        const i = v !== v ? 0 : v >= 2147483647 ? 2147483647 : v <= -2147483648 ? -2147483648 : Math.trunc(v);
        return t === 'int' ? i : t === 'short' ? (i << 16) >> 16 : t === 'byte' ? (i << 24) >> 24 : t === 'char' ? CH(i & 0xFFFF) : i;
      }
      // ── instanceof и шаблоны (case Integer i, case Point(int x, int y)) ──
      function declPat(name, type, line){
        const old = SC.v.get(name);
        if (old && old.pat) { old.type = type; return old; }
        const v = declare(name, type, line, { pat: true });
        if (PEND) PEND.push(v.js);
        return v;
      }
      function typeTest(s, t, line){
        if (NUMS.has(t) || t === 'boolean') t = BOX[t];
        const u = userC(t);
        if (u) return '$.inst(' + s + ', ' + u.js + ')';
        if (isArrT(t)) return '$.inst(' + s + ', ' + JSON.stringify('[' + arrTag(arrElem(t))) + ')';
        return '$.inst(' + s + ', ' + JSON.stringify(genName(t)) + ')';
      }
      function patCode(p, s, st, line){   // p — шаблон из caseLabel / instanceof; s — код значения (переменная)
        switch (p.p) {
          case 'null': return '(' + s + ' == null)';
          case 'default': return 'true';
          case 'type': {
            if (!p.ty) { const v = declPat(p.name, st, line); return '((' + v.js + ' = ' + s + '), true)'; }
            const t = canon(p.ty, FN && FN.cls, line);
            const test = typeTest(s, t, line);
            if (!p.name || p.name === '_') return test;
            const v = declPat(p.name, t, line);
            return '(' + test + ' && ((' + v.js + ' = ' + s + '), true))';
          }
          case 'rec': {
            const t = canon(p.ty, FN && FN.cls, line), u = userC(t);
            if (!u || u.kind !== 'record') throw JErr(p.ty + '(…) — шаблон только для записей (record)', line);
            if (p.subs.length !== u.comps.length) throw JErr('У записи ' + u.name + ' ' + u.comps.length + ' компонент(а), а в шаблоне ' + p.subs.length, line);
            let c = '$.inst(' + s + ', ' + u.js + ')';
            p.subs.forEach((sp, i) => { const cn = u.comps[i].name, ft = u.fld.get(cn).type; c += ' && ' + patCode(sp, s + '[' + fkey(cn) + ']', ft, line); });
            if (p.name) { const v = declPat(p.name, t, line); c += ' && ((' + v.js + ' = ' + s + '), true)'; }
            return '(' + c + ')';
          }
          case 'const': {
            const st2 = st && userC(st);
            if (st2 && st2.kind === 'enum' && p.e.k === 'id' && st2.fld.has(p.e.name)) return '(' + s + ' === ' + st2.js + '[' + fkey(p.e.name) + '])';
            const R = val(p.e, st);
            return eqCode('==', { c: s, t: st }, R, line).c;
          }
        }
        throw JErr('Шаблон не поддерживается', line);
      }
      function instX(n){
        const R = val(n.e);
        if (NUMS.has(R.t) || R.t === 'boolean') throw JErr('instanceof — для объектов, а здесь ' + R.t, n.line);
        const pre = [], s = once(R.c, pre);
        if (n.pat) return { c: seq(pre, patCode(n.pat, s, R.t, n.line)), t: 'boolean' };
        const t = canon(n.ty, FN && FN.cls, n.line);
        const fu = userC(R.t), tu = userC(t);
        if (fu && tu && !fu.iface && !tu.iface && !isSubC(fu, tu) && !isSubC(tu, fu)) throw JErr('instanceof: ' + fu.name + ' никогда не бывает ' + tu.name + ' (классы не связаны)', n.line);
        if (!n.name) return { c: seq(pre, typeTest(s, t, n.line)), t: 'boolean' };
        const v = declPat(n.name, t, n.line);
        return { c: seq(pre, '(' + typeTest(s, t, n.line) + ' && ((' + v.js + ' = ' + s + '), true))'), t: 'boolean' };
      }
      // ── функциональные интерфейсы: тип → { name, js, ps, ret } ──
      function abstractOvs(u){
        const out = new Map(), defaults = new Set();
        const walk = x => { members(x); nameMethods(x); for (const m of x.mth.values()) for (const ov of m.ovs) { if (OBJ_METHODS.has(ov.name)) continue; const k = ov.name + '/' + ov.key; if (!ov.abstract) defaults.add(k); else if (!out.has(k)) out.set(k, ov); } for (const it of x.ifaces) { const ic = userC(it); if (ic) walk(ic); } };
        walk(u);
        return [...out.entries()].filter(([k]) => !defaults.has(k)).map(([, v]) => v);
      }
      function fiOf(t){
        if (!t) return null;
        if (genName(t) === 'AnyFn') return { any: true };
        const u = userC(t);
        if (u) {
          if (!u.iface) return null;
          const abs = abstractOvs(u);
          if (abs.length !== 1) return null;
          const ov = abs[0], map = {};
          ov.cls.tps.forEach((x, i) => { const as = asSuper(t, ov.cls.q); map[x] = as ? genArgs(as)[i] || null : null; });
          return { name: ov.name, js: ov.js, ps: ov.params.map(p => subst(p.ty, map)), ret: subst(ov.ret, map), user: u, ov };
        }
        for (const s of supers(t)) {
          const e = libE(s);
          if (e && e.fi) { const map = {}; e.tps.forEach((x, i) => map[x] = genArgs(s)[i] || null); return { name: e.fi.name, js: e.fi.js, ps: e.fi.ps.map(p => subst(p, map)), ret: subst(e.fi.ret, map), lib: e.name }; }
        }
        return null;
      }
      // ── вывод параметров типа: unify(Function<T,R>, Function<String,Integer>) → T = String, R = Integer ──
      // общий тип двух типов-аргументов (List.of(1, 2.5) → Number, List.of(круг, квадрат) → общий предок)
      const NUMBOX = new Set(['Integer', 'Long', 'Double', 'Float', 'Short', 'Byte', 'Number']);
      function lub2(x, y){
        if (x === y) return x;
        if (NUMBOX.has(genName(x)) && NUMBOX.has(genName(y))) return 'Number';
        const sy = supers(y).map(genName);
        for (const s of supers(x)) if (s !== 'Object' && sy.includes(genName(s))) return s;
        return 'Object';
      }
      function unify(p, a, map, tvs){
        if (!p || !a || a === 'var') return;
        if (tvs.includes(p)) { const b = boxed(a); if (!map[p] || map[p] === 'Object') map[p] = b; else if (map[p] !== b) map[p] = lub2(map[p], b); return; }
        if (isArrT(p)) { if (isArrT(a)) unify(arrElem(p), arrElem(a), map, tvs); return; }
        const pa = genArgs(p); if (!pa.length) return;
        const sa = genName(a) === genName(p) ? a : asSuper(a, genName(p)); if (!sa) return;
        const aa = genArgs(sa);
        pa.forEach((x, i) => unify(x, aa[i], map, tvs));
      }
      const fillT = (t, map, tvs) => { if (!t) return t; const s = subst(t, map); if (tvs.includes(s)) return null; return s; };
      const isPoly = a => a.k === 'lambda' || a.k === 'mref' || (a.k === 'cond' && (isPoly(a.a) || isPoly(a.b))) || (a.k === 'new' && /<>/.test(a.ty || '')) || (a.k === 'paren' && isPoly(a.e));
      const lamArity = a => a.k === 'lambda' ? a.params.length : a.k === 'cond' ? lamArity(isPoly(a.a) ? a.a : a.b) : -1;
      function shapeOk(a, p){
        if (a.k !== 'lambda' && a.k !== 'mref') return true;
        if (!p || unk(p)) return true;
        const fi = fiOf(p);
        if (!fi) return false;
        if (fi.any) return true;
        if (a.k === 'lambda') {
          if (fi.ps.length !== a.params.length) return false;
          if (a.body.s !== 'block' && fi.ret === 'void') return a.body.k === 'call' || a.body.k === 'asg' || a.body.k === 'post' || a.body.k === 'new' || (a.body.k === 'un' && (a.body.op === '++' || a.body.op === '--'));
          if (a.body.s === 'block' && fi.ret !== 'void' && !hasValueReturn(a.body)) return blockEndsThrow(a.body);
          return true;
        }
        return true;
      }
      function hasValueReturn(b){ let y = false; const walk = s => { if (!s || y) return; if (Array.isArray(s)) { s.forEach(walk); return; } switch (s.s) { case 'return': if (s.e) y = true; return; case 'block': walk(s.body); return; case 'if': walk(s.a); walk(s.b); return; case 'while': case 'do': case 'for': case 'foreach': case 'label': walk(s.body); return; case 'switch': s.cases.forEach(c => c.body.kind === 'stmts' ? walk(c.body.list) : c.body.kind === 'block' ? walk(c.body.b) : 0); return; case 'try': walk(s.body); s.catches.forEach(k => walk(k.body)); walk(s.fin); return; } }; walk(b); return y; }
      const blockEndsThrow = b => { const l = b.body[b.body.length - 1]; return !!l && l.s === 'throw'; };
      const paramAt = (k, i, n) => k.va && i >= k.ps.length - 1 ? (n === k.ps.length && i === n - 1 ? null : arrElem(k.ps[k.ps.length - 1])) : k.ps[i];
      const RANKW = { byte: 0, short: 1, char: 1, int: 2, long: 3, float: 4, double: 5 };
      // насколько аргумент подходит к параметру: { s: очки (-1 — нет), box: нужна упаковка/распаковка (вторая фаза выбора, как в javac) }
      function argScore(R, p){
        const isPrimP = p && (NUMS.has(p) || p === 'boolean');
        if (p === 'Object') { if (R.isNull) return { s: 2 }; const pa = prim(R.t); return NUMS.has(R.t) || R.t === 'boolean' ? { s: 2, box: true } : { s: pa ? 3 : 1 }; }
        if (!p || unk(p)) return { s: 1 };
        if (R.isNull) return isPrimP ? { s: -1 } : { s: 2 };
        const a = R.t;
        if (!a || unk(a)) return { s: 1, box: isPrimP };
        if (a === p) return { s: 12 };
        const pa = prim(a), pp = prim(p);
        if (NUMS.has(pa) && NUMS.has(p)) return UNBOX[a] ? (widens(pa, p) ? { s: 5, box: true } : { s: -1 }) : widens(pa, p) ? { s: 10 - (RANKW[p] - RANKW[pa]) } : { s: -1 };
        if (NUMS.has(pa) && UNBOX[p]) return pa === pp ? { s: 6, box: true } : { s: -1 };
        if (pa === 'boolean' && pp === 'boolean') return { s: 6, box: true };
        if ((NUMS.has(pa) || pa === 'boolean') && (genName(p) === 'Number' || genName(p) === 'Comparable' || p === 'Serializable')) return { s: 3, box: true };
        if (NUMS.has(pa) || pa === 'boolean' || isPrimP) return { s: -1 };
        if (isArrT(p) && isArrT(a)) return assignable(a, p) ? { s: 8 } : { s: -1 };
        if (assignable(a, p)) { const d = supers(a).findIndex(s => genName(s) === genName(p)); return { s: 9 - Math.min(5, d < 0 ? 5 : d) }; }
        if (userC(a) && userC(p)) return { s: -1 };
        if (libE(a) && libE(p) && !libE(a).dyn && !libE(p).dyn) return { s: -1 };
        return { s: 0 };
      }
      // выбор варианта: k = { ps, va, ret, mtps, … }; args — узлы; возвращает { k, codes, t }
      function choose(cands, args, line, label, want, recvMap){
        const fail = () => {
          const ns = [...new Set(cands.map(k => k.ps.length))].sort((a, b) => a - b);
          if (!cands.some(k => k.va) && !ns.includes(args.length)) throw JErr(label + ' ждёт ' + ns.join(' или ') + ' аргумент(ов), а передано ' + args.length, line);
          throw JErr('Нет подходящего варианта ' + label + '(' + args.map(a => shortT(PRE.get(a)?.t) ).join(', ') + ')' + (cands.length === 1 ? ': нужно (' + cands[0].ps.map(shortT).join(', ') + ')' : ''), line);
        };
        const PRE = new Map();
        const pre = a => { if (!PRE.has(a)) PRE.set(a, val(a)); return PRE.get(a); };
        let C = cands.filter(k => !k.va && args.length === k.ps.length);
        const V = cands.filter(k => k.va && args.length >= k.ps.length - 1);
        const pick = list => {
          let L = list.filter(k => args.every((a, i) => shapeOk(a, paramAt(k, i, args.length))));
          if (L.length <= 1) return L;
          const ph = [];
          const sc = L.map((k, j) => { let s = 0, box = false; for (let i = 0; i < args.length; i++) { const a = args[i]; if (isPoly(a)) { s += 1; continue; } const v = argScore(pre(a), paramAt(k, i, args.length) || k.ps[k.ps.length - 1]); if (v.s < 0) return -1; s += v.s; if (v.box) box = true; } ph[j] = box ? 2 : 1; return s; });
          if (sc.every(s => s < 0)) return [];
          const minPh = Math.min(...ph.filter((x, j) => sc[j] >= 0));
          const best = Math.max(...sc.filter((s, j) => s >= 0 && ph[j] === minPh));
          let top = L.filter((k, i) => sc[i] === best && ph[i] === minPh);
          if (top.length > 1) {   // самый «узкий» вариант
            const spec = top.filter(k => top.every(o => o === k || k.ps.every((p, i) => assignable(p, o.ps[i]) || (NUMS.has(p) && NUMS.has(o.ps[i]) && widens(p, o.ps[i])))));
            if (spec.length) top = spec.slice(0, 1).concat(spec.length > 1 ? spec.slice(1) : []);
          }
          return top;
        };
        let got = C.length ? pick(C) : [];
        if (!got.length && V.length) got = pick(V);
        if (!got.length) fail();
        const k = got[0], ambiguous = got.length > 1;
        // параметры типа метода: из ожидаемого результата и аргументов
        const tvs = (k.mtps || []).slice(), map = {};
        if (want && tvs.length && k.ret) unify(k.ret, want, map, tvs);
        const n = args.length, codes = [], Rs = [];
        const ptype = i => { const p = paramAt(k, i, n); return p === null ? k.ps[k.ps.length - 1] : p; };
        for (let i = 0; i < n; i++) if (!isPoly(args[i])) { const R = pre(args[i]); unify(ptype(i), R.t, map, tvs); }
        for (let i = 0; i < n; i++) {
          const a = args[i], p = ptype(i), pf = fillT(p, map, tvs);
          let R;
          if (isPoly(a)) {
            R = val(a, pf && !unk(pf) ? pf : p);
            if (R.bt !== undefined) { const fi = fiOf(p); if (fi && !fi.any && fi.ret && tvs.length) { if (fi.ret !== 'void') unify(fi.ret, R.bt, map, tvs); } }
            if (R.t && !isArrT(p)) unify(p, R.t, map, tvs);
          } else R = pre(a);
          Rs.push(R);
        }
        // varargs: лишние — в массив
        const va = k.va && !(n === k.ps.length && Rs[n - 1] && (isArrT(Rs[n - 1].t) || Rs[n - 1].isNull));
        for (let i = 0; i < n; i++) {
          const p = fillT(ptype(i), map, tvs);
          if (va && i >= k.ps.length - 1) continue;
          codes.push(argConv(Rs[i], p, line, k));
        }
        if (va) {
          const et = fillT(arrElem(k.ps[k.ps.length - 1]), map, tvs);
          const items = Rs.slice(k.ps.length - 1).map(R => argConv(R, et, line, k));
          codes.push(arrCode(et, items));
        }
        const t = k.ret === 'void' ? 'void' : fillT(k.ret, map, tvs);
        return { k, codes, t: t && TVAR.test(t) && !isTVName(t) ? null : t, ambiguous, Rs, map };
      }
      const argConv = (R, p, line, k) => (k && k.world) ? worldArg(R) : conv(R, p, line, 'call');
      // аргумент для мира (объекты песочницы JS): long → число, коллекции Java → массивы и объекты
      const worldArg = R => { const t = prim(R.t); if (t === 'int' || t === 'double' || t === 'float' || t === 'boolean' || R.t === 'String' || t === 'short' || t === 'byte') return R.c; if (t === 'char') return R.c; if (t === 'long') return 'Number(' + R.c + ')'; return '$.js(' + R.c + ')'; };
      function arrCode(et, items){
        const tag = arrTag(et);
        if (tag === 'L' || tag === 'C' || tag === 'Z') return '[' + items.join(', ') + ']';
        return '$.mka(' + JSON.stringify(tag) + ', [' + items.join(', ') + '])';
      }
      // ── ожидание (wait / sleep): в генераторе — yield; вызов «ждущей» функции — yield* ──
      function suspend(code, line, kind){
        if (PASS === 1) { if (FN) FN.direct = true; else TOPSUSP.direct = true; return code; }
        if (!FN || !FN.gen) {
          const where = FN && (FN.kind === 'ctor' ? 'в конструкторе' : FN.kind === 'finit' || FN.kind === 'clinit' ? 'при создании полей' : FN.syncOnly ? 'в ' + FN.name + '() (его вызывает сама Java: сортировка, печать, коллекции)' : '');
          throw JErr('Ждать (wait / sleep) здесь нельзя' + (where ? ' — ' + where : '') + ': перенеси ожидание в обычный метод (start(), main(), обработчик события)', line);
        }
        return '(yield ' + code + ')';
      }
      function suspCall(code, fam, line){
        if (PASS === 1) { (FN || TOPSUSP).edges.add(fam); return code; }
        if (!FAMS.has(fam)) return code;
        if (!FN || !FN.gen) {
          const where = FN && (FN.kind === 'ctor' ? 'в конструкторе' : FN.kind === 'finit' || FN.kind === 'clinit' ? 'при создании полей' : FN.syncOnly ? 'в ' + FN.name + '()' : '');
          throw JErr('Этот метод ждёт (в нём wait / sleep), а вызывать его здесь нельзя' + (where ? ' — ' + where : '') + ': вызови его из обычного метода', line);
        }
        return '(yield* ' + code + ')';
      }
      const famOf = ov => ov.name + '/' + (ov.famKey || ov.key || '');
      let TOPSUSP = { direct: false, edges: new Set() }, FAMS = new Set(), GENS = new Set();

      // ── вызовы ──
      function callX(n, want){
        const f = n.f;
        if (f.k === 'id') return callName(f.name, n, want);
        if (f.k === 'mem') return callMem(f, n, want);
        if (f.k === 'paren' || f.k === 'lambda') throw JErr('Лямбду так не вызвать: сохрани её в переменную интерфейса и вызови метод (r.run(), f.apply(x))', n.line);
        throw JErr('Это не метод — его нельзя вызвать', n.line);
      }
      function callName(name, n, want){
        const v = lookupVar(name);
        if (FN && FN.cls) {
          for (let c = FN.cls, k = 0; c && k < 30; c = c.outer || c.declCls, k++) {
            const ovs = userOvs(c, name, false).concat(userOvs(c, name, true).filter(o => o.static));
            if (ovs.length && name === 'wait' && MODE === 'studio' && ovs.every(o => o.lib)) return globalCall(name, n, want);   // Script.wait(сек) — ожидание, как у кода верхнего уровня
            if (!ovs.length && c.kind === 'enum' && (name === 'values' || name === 'valueOf')) return enumStatic(c, name, n);
            if (ovs.length) return callUser(c, ovs, null, n, want, name, true);
          }
        }
        if (MAIN.mth) { const ovs = userOvs(MAIN, name, true); if (ovs.length) return callUser(MAIN, ovs, null, n, want, name, true); }
        // import static
        { const owner = SIMP.get(name) || [...SIMP.keys()].filter(k => k[0] === '*').map(k => SIMP.get(k)).find(o => { const e = lib().get(libQ(o) || o), u = userC(o); return (e && e.s.has(name)) || (u && userOvs(u, name, true).length); });
          if (owner) { const u = userType(owner.split('.').pop(), FN && FN.cls); if (u) return callUser(u, userOvs(u, name, true), u.js, n, want, name, false); return libStatic(libQ(owner) || owner, name, n, want); } }
        if (v) throw JErr('«' + name + '» — переменная, а не метод' + (v.type && fiOf(v.type) ? ': вызови так — ' + name + '.' + (fiOf(v.type).name || 'run') + '(…)' : ''), n.line);
        const g = globalCall(name, n, want);
        if (g) return g;
        throw Object.assign(JErr('Метод «' + name + '» не найден' + callHint(name), n.line), { unk: true });
      }
      function callHint(name){
        if (name === 'println' || name === 'printf') return ' — печать: System.out.' + name + '(…)';
        if (name === 'print' && MODE === 'plain') return ' — печать: System.out.println(…)';
        if (name === 'len' || name === 'size' || name === 'length') return ' — длина: s.length(), list.size(), arr.length';
        if (name === 'input' || name === 'readLine') return ' — ввода нет (песочница)';
        return '';
      }
      // глобальные функции API: wait(сек), print(…), warn(…), random(a, b)
      function globalCall(name, n, want){
        const A = n.args;
        if (name === 'print' || name === 'warn') return { c: '$.' + (name === 'print' ? 'gprint' : 'gwarn') + '(' + A.map(a => strOf(val(a))).join(', ') + ')', t: 'void' };
        if (MODE !== 'studio') return null;
        if (name === 'wait') { if (A.length > 1) throw JErr('wait(секунды) — один аргумент', n.line); const s = A.length ? conv(val(A[0]), 'double', n.line, 'call') : '0'; return { c: suspend('$.W(' + s + ')', n.line), t: 'double' }; }
        if (name === 'random') { const R = A.map(a => conv(val(a), 'int', n.line, 'call')); return { c: '$G.random(' + R.join(', ') + ')', t: A.length ? 'int' : 'double' }; }
        if (name === 'tick' || name === 'time') return { c: '$.clock()', t: 'double' };
        return null;
      }
      // у каждого enum есть static values() и valueOf("ИМЯ")
      function enumStatic(c, name, n){
        if (name === 'values') { if (n.args.length) throw JErr(c.name + '.values() — без аргументов', n.line); return { c: ownerJs(c) + '.$values.slice()', t: c.q + '[]' }; }
        if (n.args.length !== 1) throw JErr(c.name + '.valueOf("ИМЯ") — один аргумент', n.line);
        return { c: '$.enumOf(' + ownerJs(c) + ', ' + conv(val(n.args[0]), 'String', n.line, 'call') + ')', t: c.q };
      }
      function callMem(f, n, want){
        const name = f.name;
        if (f.o.k === 'super') return superCall(name, n, want);
        if (f.o.k === 'isuper') {
          const ic = userType(f.o.ty, FN && FN.cls);
          if (!ic || !ic.iface) throw JErr(f.o.ty + '.super — только для интерфейса', n.line);
          const r = callUser(ic, userOvs(ic, name, false), null, n, want, name, false, true);
          return r;
        }
        const O = f.o.k === 'id' || f.o.k === 'mem' ? raw(f.o) : val(f.o);
        if (O.pkg) { const full = O.pkg + '.' + name; throw JErr('«' + full + '» не найдено' + (PKG_NO.find(([re]) => re.test(full)) ? ': ' + PKG_NO.find(([re]) => re.test(full))[1] : ''), n.line); }
        if (O.ty && O.ty.c) {
          const c = O.ty.c;
          if (c.kind === 'enum' && (name === 'values' || name === 'valueOf') && !userOvs(c, name, true).length) return enumStatic(c, name, n);
          const ovs = userOvs(c, name, true);
          if (!ovs.length) {
            if (userOvs(c, name, false).length) throw JErr('Метод ' + name + ' — не static: нужен объект (' + c.name + ' x = new ' + c.name + '(…); x.' + name + '(…))', n.line);
            throw JErr('У ' + c.name + ' нет метода ' + name + memHint(c, name), n.line);
          }
          return callUser(c, ovs, c.js, n, want, name, false);
        }
        if (O.ty && O.ty.lib) return libStatic(O.ty.lib, name, n, want);
        return instCall(O, name, n, want, f);
      }
      // вызов своего метода: ovs — варианты, recv — код объекта (null — this / внешний класс / класс)
      function callUser(c, ovs, recv, n, want, name, implicitRecv, iSuper, recvT){
        const label = name;
        let rmap = null;
        if (recvT) { rmap = {}; for (const ov of ovs) if (ov.cls && ov.cls.tps && ov.cls.tps.length) { const as = asSuper(recvT, ov.cls.q); ov.cls.tps.forEach((x, i) => { if (as && genArgs(as)[i]) rmap[x] = genArgs(as)[i]; }); } }
        const cands = ovs.map(ov => ({ ps: ov.params.map(p => rmap ? subst(p.ty, rmap) : p.ty), va: ov.va, ret: rmap ? subst(ov.ret, rmap) : ov.ret, mtps: ov.tps || [], ov, js: ov.js }));
        const r = choose(cands, n.args, n.line, label, want, null);
        const ov = r.k.ov;
        let jsn = r.ambiguous ? mjs(name) : ov.js;
        if (ov.acc && !ov.fn) jsn = ov.js;
        let code;
        if (ov.static) code = ownerJs(ov.cls) + '.' + jsn + '(' + r.codes.join(', ') + ')';
        else {
          let self = recv;
          if (iSuper) code = ownerJs(ov.cls) + '.prototype.' + jsn + '.call(' + (FN.self) + (r.codes.length ? ', ' + r.codes.join(', ') : '') + ')';
          else {
            if (!self) {
              const tc = ov.cls || c;
              if (FN && FN.isStatic && !instExpr(tc, n.line, true)) throw JErr('Метод ' + name + ' — не static: из static-метода его так не вызвать (нужен объект или static у метода)', n.line);
              self = instExpr(tc, n.line);
            }
            code = recvCode(self) + '.' + jsn + '(' + r.codes.join(', ') + ')';
          }
        }
        if (ov.fn || ov.abstract) code = suspCall(code, famOf(ov), n.line);
        return { c: code, t: r.t, ucall: ov };
      }
      const recvCode = c => /^[\d.]/.test(c) || /^-/.test(c) ? '(' + c + ')' : c;
      function substRecv(t, recvT, cls){
        if (!t || !cls.tps || !cls.tps.length) return t;
        const as = asSuper(recvT, cls.q); if (!as) return t;
        const map = {}; cls.tps.forEach((x, i) => map[x] = genArgs(as)[i] || null);
        return subst(t, map);
      }
      function superCall(name, n, want){
        if (!FN || !FN.cls || FN.isStatic) throw JErr('super — только в методах объекта', n.line);
        const c = FN.cls;
        if (c.baseC) {
          const ovs = userOvs(c.baseC, name, false);
          if (ovs.length) {
            const cands = ovs.map(ov => ({ ps: ov.params.map(p => p.ty), va: ov.va, ret: ov.ret, mtps: ov.tps || [], ov }));
            const r = choose(cands, n.args, n.line, 'super.' + name, want);
            const ov = r.k.ov;
            if (ov.abstract) throw JErr('super.' + name + '() — у базового класса метод абстрактный (без тела)', n.line);
            const jsn = r.ambiguous ? mjs(name) : ov.js;
            const sup = FN.self === 'this' ? 'super' : null;
            if (!sup) throw JErr('super.' + name + '() внутри лямбды с ожиданием (wait) не поддерживается — вынеси вызов в метод', n.line);
            return { c: suspCall('super.' + jsn + '(' + r.codes.join(', ') + ')', famOf(ov), n.line), t: r.t };
          }
        }
        // базовый класс библиотеки (Script, Exception, Block …) или Object
        const lt = c.libBaseT || c.libBase || 'Object';
        const sigs = libCands(lt, name, false);
        if (!sigs.length) throw JErr('У базового класса нет метода ' + name, n.line);
        const r = choose(sigs, n.args, n.line, 'super.' + name, want);
        return { c: 'super.' + r.k.js + '(' + r.codes.join(', ') + ')', t: r.t };
      }
      // методы библиотечного типа t: варианты со всеми предками (ArrayList → List → Collection → Iterable)
      function libCands(t, name, wantStatic){
        const out = [], seen = new Set();
        for (const s of wantStatic ? [t] : supers(t)) {
          const e = libE(s); if (!e) continue;
          const M = wantStatic ? e.s : e.m;
          for (const sg of M.get(name) || []) {
            const map = {}; e.tps.forEach((x, i) => map[x] = wantStatic ? null : genArgs(s)[i] || null);
            const ps = sg.ps.map(p => subst(p, map)), key = ps.join(',') + (sg.va ? '...' : '');
            if (seen.has(key)) continue; seen.add(key);
            out.push({ ps, va: sg.va, ret: subst(sg.ret, map), mtps: (sg.mtps || []).concat(wantStatic ? e.tps : []), sg, js: sg.js, owner: e.name, ownerT: s, lib: true, world: !!e.world });
          }
        }
        return out;
      }
      // ── вызов метода у значения ──
      const SUSP_WORLD = new Set(['WaitForChild', 'Wait']);
      function instCall(O, name, n, want){
        const t = O.t;
        if (O.isNull) throw JErr('Вызов метода у null — будет NullPointerException', n.line);
        if (t && (NUMS.has(t) || t === 'boolean')) throw JErr('У ' + t + ' нет методов (это простое значение)' + (name === 'equals' ? ' — сравнивай через ==' : name === 'toString' ? ' — в строку: String.valueOf(x)' : name === 'length' ? '' : ''), n.line);
        if (t && isArrT(t)) {
          if (name === 'clone' && !n.args.length) return { c: '$.aclone(' + O.c + ')', t };
          if (OBJ_METHODS.has(name)) return objCall(O, name, n);
          throw JErr('У массива нет метода ' + name + (name === 'length' ? ' — длина массива пишется без скобок: arr.length' : /^(size|add|get|contains|indexOf|sort|stream)$/.test(name) ? ' (это у списка List; у массива — arr.length, Arrays.sort(arr), Arrays.stream(arr))' : ''), n.line);
        }
        const u = userC(t);
        if (u) {
          const ovs = userOvs(u, name, false).concat(userOvs(u, name, true));
          if (!ovs.length || (ovs.every(o => o.obj) && !(u.mth && u.mth.has(name)))) {
            if (u.libBase && u.libBase !== 'Object') { const sigs = libCands(u.libBaseT || u.libBase, name, false); if (sigs.length) return libInst(O, u.libBaseT || u.libBase, sigs, name, n, want); }
            if (OBJ_METHODS.has(name)) return objCall(O, name, n);
            throw JErr('У ' + u.name + ' нет метода ' + name + memHint(u, name), n.line);
          }
          return callUser(u, ovs, O.c, n, want, name, false, false, t);
        }
        if (t === 'String') return strCall(O, name, n, want);
        if (UNBOX[t]) return boxedCall(O, name, n);
        if (t === 'PrintStream') return printCall(O.c, name, n);
        if (t === 'StringBuilder' && (name === 'append' || name === 'insert')) return sbCall(O, name, n);
        if (genName(t) === 'Comparable' && name === 'compareTo' && n.args.length === 1) return { c: '$.cmp(' + O.c + ', ' + val(n.args[0]).c + ')', t: 'int' };
        if (t === 'Number' && !n.args.length && /^(int|long|double|float|short|byte)Value$/.test(name)) return { c: '$.dc(' + O.c + ', ' + JSON.stringify(name) + ', [])', t: name.slice(0, -5) };
        const e0 = libE(t), fi = e0 && e0.iface && genName(t) !== 'Comparable' ? fiOf(t) : null;
        if (fi && !fi.any && !userC(t)) {
          if (name === fi.name) {
            if (n.args.length !== fi.ps.length) throw JErr(shortT(t) + '.' + name + ' ждёт ' + fi.ps.length + ' аргумент(ов)', n.line);
            const codes = n.args.map((a, i) => conv(val(a, fi.ps[i]), fi.ps[i], n.line, 'call'));
            return { c: '$.ci(' + O.c + ', ' + JSON.stringify(fi.js) + (codes.length ? ', ' + codes.join(', ') : '') + ')', t: fi.ret === 'void' ? 'void' : (fi.ret && TVAR.test(fi.ret) && !isTVName(fi.ret) ? null : fi.ret) };
          }
          const sigs = libCands(t, name, false);
          if (sigs.length) { const r = choose(sigs, n.args, n.line, shortT(t) + '.' + name, want); return { c: '$F.' + r.k.js + '(' + [O.c].concat(r.codes).join(', ') + ')', t: r.t }; }
          if (OBJ_METHODS.has(name)) return objCall(O, name, n);
        }
        const sigs = t ? libCands(t, name, false) : [];
        if (sigs.length) return libInst(O, t, sigs, name, n, want);
        if (OBJ_METHODS.has(name)) return objCall(O, name, n);
        if (t && !unk(t) && libE(t) && !libE(t).dyn) throw JErr('У ' + shortT(t) + ' нет метода ' + name + libHint(libE(t), name), n.line);
        // тип неизвестен — вызов «во время работы»
        const args = n.args.map(a => val(a));
        return { c: '$.dc(' + O.c + ', ' + JSON.stringify(name) + ', [' + args.map(R => worldArg(R)).join(', ') + '])', t: null };
      }
      function libInst(O, t, sigs, name, n, want){
        if (name === 'collect' && genName(t) === 'Stream' && n.args.length === 1) return collectX(O, genArgs(t)[0] || null, n);
        if (name === 'toList' && genName(t) === 'Stream') { const et = genArgs(t)[0] || null; return { c: tagKinds(O.c + '.toList()', 'List<' + (et || 'Object') + '>'), t: 'List<' + (et || 'Object') + '>' }; }
        const r = choose(sigs, n.args, n.line, shortT(t) + '.' + name, want);
        let code = recvCode(O.c) + '.' + r.k.js + '(' + r.codes.join(', ') + ')';
        if (r.k.world && SUSP_WORLD.has(name)) code = suspend('$.P(' + code + ')', n.line);
        if (r.k.world && name === 'wait' && genName(t) === 'TaskLib') code = suspend('$.W(' + (r.codes[0] || '0') + ')', n.line);
        if (r.k.world && (name === 'wait' && genName(t) === 'ModApi' || name === 'read' && genName(t) === 'ModWorld')) code = suspend('$.P(' + code + ')', n.line);
        if (name === 'sleep' && genName(t) === 'TimeUnit') code = suspend('$.W(' + O.c + '.sec(' + r.codes[0] + '))', n.line);
        let rt = r.t;
        if (rt && /\bR\b|\bU\b/.test(rt) && !isTVName('R')) rt = rt.replace(/\b[RU]\b/g, 'Object');
        if (r.k.world && rt && /^List</.test(rt)) code = '$.jlist(' + code + ')';
        return { c: tagKinds(code, rt), t: rt };
      }
      // Stream.collect(Collectors.…) — тип результата по сборщику
      function collectX(O, T, n){
        const a = n.args[0];
        const C = collectorX(a, T);
        return { c: tagKinds(recvCode(O.c) + '.collect(' + C.c + ')', C.t), t: C.t };
      }
      function collectorX(a, T){
        const isColl = a.k === 'call' && a.f.k === 'mem' && ((a.f.o.k === 'id' && a.f.o.name === 'Collectors') || (a.f.o.k === 'mem' && a.f.o.name === 'Collectors'));
        const isColl2 = a.k === 'call' && a.f.k === 'id' && SIMP.get(a.f.name) && /Collectors$/.test(SIMP.get(a.f.name));
        if (!isColl && !isColl2) { const R = val(a); return { c: R.c, t: null }; }
        const name = isColl ? a.f.name : a.f.name, A = a.args, et = T || 'Object';
        USED.add('Collectors');
        const fn = (x, ps, ret) => val(x, ps ? mkFI(ps, ret) : null);
        const lamT = (x, p) => { const R = val(x, 'Function<' + p + ',R>'); return { c: R.c, t: R.bt !== undefined ? (R.bt && R.bt !== 'void' ? boxed(R.bt) : null) : fiRet(R.t) }; };
        const C = '$A.Collectors.';
        switch (name) {
          case 'toList': case 'toUnmodifiableList': return { c: C + name + '()', t: 'List<' + et + '>' };
          case 'toSet': case 'toUnmodifiableSet': return { c: C + name + '()', t: 'Set<' + et + '>' };
          case 'joining': return { c: C + 'joining(' + A.map(x => conv(val(x), 'String', x.line, 'call')).join(', ') + ')', t: 'String' };
          case 'counting': return { c: C + 'counting()', t: 'Long' };
          case 'summingInt': case 'summingLong': case 'summingDouble': case 'averagingInt': case 'averagingLong': case 'averagingDouble': {
            const pt = name.endsWith('Int') ? 'ToIntFunction<' + et + '>' : name.endsWith('Long') ? 'ToLongFunction<' + et + '>' : 'ToDoubleFunction<' + et + '>';
            const f = val(A[0], pt);
            return { c: C + name + '(' + f.c + ')', t: name.startsWith('averaging') ? 'Double' : name === 'summingInt' ? 'Integer' : name === 'summingLong' ? 'Long' : 'Double' };
          }
          case 'summarizingInt': return { c: C + name + '(' + val(A[0], 'ToIntFunction<' + et + '>').c + ')', t: 'IntSummaryStatistics' };
          case 'minBy': case 'maxBy': return { c: C + name + '(' + val(A[0], 'Comparator<' + et + '>').c + ')', t: 'Optional<' + et + '>' };
          case 'groupingBy': {
            const k = lamT(A[0], et);
            if (A.length === 1) return { c: C + 'groupingBy(' + k.c + ')', t: 'Map<' + (k.t || 'Object') + ',List<' + et + '>>' };
            const sup = A.length === 3 ? val(A[1]).c : null, d = collectorX(A[A.length - 1], et);
            return { c: C + 'groupingBy(' + k.c + ', ' + (sup || 'null') + ', ' + d.c + ')', t: 'Map<' + (k.t || 'Object') + ',' + (d.t || 'Object') + '>' };
          }
          case 'partitioningBy': {
            const p = val(A[0], 'Predicate<' + et + '>');
            if (A.length === 1) return { c: C + 'partitioningBy(' + p.c + ')', t: 'Map<Boolean,List<' + et + '>>' };
            const d = collectorX(A[1], et);
            return { c: C + 'partitioningBy(' + p.c + ', ' + d.c + ')', t: 'Map<Boolean,' + (d.t || 'Object') + '>' };
          }
          case 'mapping': { const f = lamT(A[0], et), d = collectorX(A[1], f.t || 'Object'); return { c: C + 'mapping(' + f.c + ', ' + d.c + ')', t: d.t }; }
          case 'filtering': { const p = val(A[0], 'Predicate<' + et + '>'), d = collectorX(A[1], et); return { c: C + 'filtering(' + p.c + ', ' + d.c + ')', t: d.t }; }
          case 'toMap': {
            const k = lamT(A[0], et), v = lamT(A[1], et);
            const rest = A.slice(2).map((x, i) => val(x, i === 0 ? 'BinaryOperator<' + (v.t || 'Object') + '>' : null).c);
            return { c: C + 'toMap(' + [k.c, v.c].concat(rest).join(', ') + ')', t: 'Map<' + (k.t || 'Object') + ',' + (v.t || 'Object') + '>' };
          }
          case 'toCollection': { const s = val(A[0], 'Supplier<Object>'); const ct = s.bt ? genName(s.bt) : 'Collection'; return { c: C + 'toCollection(' + s.c + ')', t: ct + '<' + et + '>' }; }
          case 'collectingAndThen': { const d = collectorX(A[0], et); const f = val(A[1], 'Function<' + (d.t || 'Object') + ',R>'); return { c: C + 'collectingAndThen(' + d.c + ', ' + f.c + ')', t: f.bt ? boxed(f.bt) : null }; }
          case 'reducing': { const R = A.map(x => val(x, 'BinaryOperator<' + et + '>')); return { c: C + 'reducing(' + R.map(r => r.c).join(', ') + ')', t: et }; }
        }
        const R = val(a); return { c: R.c, t: null };
      }
      const mkFI = (ps, ret) => 'Function<' + ps[0] + ',' + ret + '>';
      const fiRet = t => { const f = fiOf(t); return f && !f.any ? f.ret : null; };
      // строки: методы — через $S (у JS-строк свои методы с другим смыслом)
      function strCall(O, name, n, want){
        const s = O.c;
        if (name === 'length' && !n.args.length) return { c: recvCode(s) + '.length', t: 'int' };
        if ((name === 'format' || name === 'formatted') && name === 'formatted') return fmtCall(s, n.args, n.line, 'String');
        const sigs = libCands('String', name, false);
        if (!sigs.length) {
          if (OBJ_METHODS.has(name)) return objCall(O, name, n);
          throw JErr('У String нет метода ' + name + libHint(libE('String'), name) + (name === 'size' ? ' — длина строки: s.length()' : name === 'get' ? ' — символ: s.charAt(i)' : name === 'reverse' ? ' — переворот: new StringBuilder(s).reverse().toString()' : ''), n.line);
        }
        const r = choose(sigs, n.args, n.line, 'String.' + name, want);
        USED.add('$S');
        return { c: '$S.' + r.k.js + '(' + [s].concat(r.codes).join(', ') + ')', t: r.t, nn: r.t === 'String' };
      }
      function sbCall(O, name, n){
        const A = n.args;
        if (name === 'append') {
          if (A.length === 3) { const R = A.map(a => val(a)); return { c: O.c + '.append($.chars(' + R[0].c + ', ' + conv(R[1], 'int', n.line, 'call') + ', ' + conv(R[2], 'int', n.line, 'call') + '))', t: 'StringBuilder' }; }
          if (A.length !== 1) throw JErr('append(x) — один аргумент', n.line);
          const R = val(A[0]);
          return { c: O.c + '.append(' + (R.t === 'char[]' ? '$.chars(' + R.c + ')' : strOf(R)) + ')', t: 'StringBuilder' };
        }
        if (A.length !== 2) throw JErr('insert(позиция, x) — два аргумента', n.line);
        const I = val(A[0]), R = val(A[1]);
        return { c: O.c + '.insert(' + conv(I, 'int', n.line, 'call') + ', ' + (R.t === 'char[]' ? '$.chars(' + R.c + ')' : strOf(R)) + ')', t: 'StringBuilder' };
      }
      // упакованные числа: Integer x → x.intValue(), x.compareTo(y), x.equals(o) …
      function boxedCall(O, name, n){
        const t = O.t, p = UNBOX[t], A = n.args;
        const ub = '$.ub(' + O.c + ')';
        const NV = { intValue: 'int', longValue: 'long', doubleValue: 'double', floatValue: 'float', shortValue: 'short', byteValue: 'byte', charValue: 'char', booleanValue: 'boolean' };
        if (NV[name] && !A.length) { if ((p === 'boolean') !== (NV[name] === 'boolean') || (p === 'char') !== (NV[name] === 'char')) throw JErr('У ' + t + ' нет метода ' + name, n.line); return { c: p === 'boolean' || p === 'char' ? ub : numConv({ c: ub }, p, NV[name], n.line, 'cast'), t: NV[name] }; }
        if (name === 'compareTo' && A.length === 1) { const R = val(A[0], t); return { c: '$.cmp(' + ub + ', ' + conv(R, p, n.line, 'call') + ')', t: 'int' }; }
        if (name === 'equals' && A.length === 1) { const R = val(A[0]); return { c: '$.beq(' + O.c + ', ' + R.c + ', ' + JSON.stringify(p) + ', ' + JSON.stringify(prim(R.t) || '') + ')', t: 'boolean' }; }
        if (name === 'hashCode' && !A.length) return { c: '$.hc(' + ub + ', ' + JSON.stringify(p) + ')', t: 'int' };
        if (name === 'toString' && !A.length) return { c: strOf({ c: ub, t: p }), t: 'String', nn: true };
        if ((name === 'isNaN' || name === 'isInfinite') && (p === 'double' || p === 'float')) return { c: name === 'isNaN' ? 'Number.isNaN(' + ub + ')' : '$A.Double.isInfinite(' + ub + ')', t: 'boolean' };
        if (name === 'getClass') return objCall(O, name, n);
        throw JErr('У ' + t + ' нет метода ' + name, n.line);
      }
      function objCall(O, name, n){
        const A = n.args;
        switch (name) {
          case 'equals': if (A.length !== 1) break; return { c: '$.eqn(' + O.c + ', ' + val(A[0]).c + ')', t: 'boolean' };
          case 'hashCode': if (A.length) break; return { c: '$.hcn(' + O.c + ')', t: 'int' };
          case 'toString': if (A.length) break; return { c: '$.tostr(' + O.c + ')', t: 'String', nn: true };
          case 'getClass': if (A.length) break; return { c: '$.getClass(' + O.c + ')', t: 'Class' };
        }
        throw JErr(name + '(…): неверное число аргументов', n.line);
      }
      // System.out / System.err
      function printCall(ps, name, n){
        const A = n.args;
        switch (name) {
          case 'println': if (A.length > 1) throw JErr('println(x) — один аргумент (склей строки через +)', n.line); if (!A.length) return { c: ps + '.println("")', t: 'void' }; { const R = val(A[0]); return { c: ps + '.println(' + (R.t === 'char[]' ? '$.chars(' + R.c + ')' : strOf(R)) + ')', t: 'void' }; }
          case 'print': if (A.length !== 1) throw JErr('print(x) — один аргумент', n.line); { const R = val(A[0]); return { c: ps + '.print(' + (R.t === 'char[]' ? '$.chars(' + R.c + ')' : strOf(R)) + ')', t: 'void' }; }
          case 'printf': case 'format': { const f = fmtCall(null, A, n.line, 'x'); return { c: ps + '.print(' + f.c + ')', t: 'PrintStream' }; }
          case 'flush': case 'close': return { c: 'void 0', t: 'void' };
          case 'write': throw JErr('System.out.write не поддерживается — пиши System.out.print', n.line);
        }
        throw JErr('У System.out нет метода ' + name + ' (есть println, print, printf)', n.line);
      }
      // String.format / printf: формат + значения + их типы (чтобы %d, %.2f, %s печатали как в Java)
      function fmtCall(self, A, line){
        let args = A.slice();
        if (!self && args.length && args[0].k !== 'str') { const R0 = raw(args[0]); if (R0.t === 'Locale' || (R0.ty && R0.ty.lib === 'Locale')) args = args.slice(1); }
        let fmt;
        if (self) fmt = self; else { if (!args.length) throw JErr('Нужна строка формата: String.format("%d", x)', line); fmt = conv(val(args[0]), 'String', line, 'call'); args = args.slice(1); }
        const Rs = args.map(a => val(a));
        if (Rs.length === 1 && Rs[0].t && isArrT(Rs[0].t) && !NUMS.has(arrElem(Rs[0].t))) return { c: '$.format(' + fmt + ', ' + Rs[0].c + ', null)', t: 'String', nn: true };
        const tags = Rs.map(R => { const p = prim(R.t); return R.isNull ? 'N' : p === 'int' || p === 'short' || p === 'byte' ? 'I' : p === 'long' ? 'J' : p === 'double' ? 'D' : p === 'float' ? 'F' : p === 'char' ? 'C' : p === 'boolean' ? 'Z' : R.t === 'String' ? 'S' : 'O'; }).join('');
        return { c: '$.format(' + fmt + ', [' + Rs.map(R => R.c).join(', ') + '], ' + JSON.stringify(tags) + ')', t: 'String', nn: true };
      }
      // ── статические методы библиотеки: Math, String, Integer, Arrays, Collections, List.of … ──
      function libStatic(ln, name, n, want){
        const A = n.args;
        const one = () => { if (A.length !== 1) throw JErr(ln + '.' + name + '(x) — один аргумент', n.line); return val(A[0]); };
        if (ln === 'Math' || ln === 'StrictMath') {
          const mm = mathCall(name, n);
          if (mm) return mm;
        }
        if (ln === 'String') {
          if (name === 'valueOf' && A.length === 1) { const R = one(); return { c: R.t === 'char[]' ? '$.chars(' + R.c + ')' : strOf(R), t: 'String', nn: true }; }
          if (name === 'valueOf' || name === 'copyValueOf') { const R = A.map(a => val(a)); return { c: '$.chars(' + R.map((r, i) => i ? conv(r, 'int', n.line, 'call') : r.c).join(', ') + ')', t: 'String', nn: true }; }
          if (name === 'format') return fmtCall(null, A, n.line);
          if (name === 'join') {
            if (A.length < 2) throw JErr('String.join(разделитель, элементы…)', n.line);
            const sep = conv(val(A[0]), 'String', n.line, 'call'), R = A.slice(1).map(a => val(a));
            if (R.length === 1 && R[0].t && !NUMS.has(R[0].t) && R[0].t !== 'String') return { c: '$.join(' + sep + ', ' + R[0].c + ')', t: 'String', nn: true };
            return { c: '$.join(' + sep + ', [' + R.map(r => strOf(r)).join(', ') + '])', t: 'String', nn: true };
          }
        }
        if (ln === 'System') {
          if (name === 'currentTimeMillis') return { c: '$.millis()', t: 'long' };
          if (name === 'nanoTime') return { c: '$.nanos()', t: 'long' };
          if (name === 'exit') return { c: '$.exit()', t: 'void' };
          if (name === 'lineSeparator') return { c: '"\\n"', t: 'String', nn: true };
          if (name === 'getProperty') return { c: '$.prop(' + A.map(a => conv(val(a), 'String', n.line, 'call')).join(', ') + ')', t: 'String' };
          if (name === 'getenv') return { c: 'null', t: 'String' };
          if (name === 'gc') return { c: 'void 0', t: 'void' };
        }
        if (ln === 'Thread') {
          if (name === 'sleep') { if (!A.length || A.length > 2) throw JErr('Thread.sleep(миллисекунды)', n.line); const R = val(A[0]); return { c: suspend('$.W(' + conv(R, 'double', n.line, 'call') + ' / 1000)', n.line), t: 'void' }; }
          if (name === 'onSpinWait' || name === 'yield') return { c: 'void 0', t: 'void' };
          throw JErr('Потоков нет: Thread.' + name + ' не поддерживается (жди через Thread.sleep(мс) или wait(сек))', n.line);
        }
        if ((ln === 'Integer' || ln === 'Long' || ln === 'Double' || ln === 'Float' || ln === 'Short' || ln === 'Byte' || ln === 'Boolean' || ln === 'Character')) {
          const p = UNBOX[ln];
          if (name === 'valueOf' && A.length === 1) { const R = one(); if (R.t === 'String') return { c: '$A.' + ln + '.valueOf(' + R.c + ')', t: ln }; return { c: conv(R, ln, n.line, 'call'), t: ln }; }
          if (name === 'toString' && A.length === 1) { const R = one(); return { c: strOf({ c: conv(R, p, n.line, 'call'), t: p }), t: 'String', nn: true }; }
          if ((name === 'max' || name === 'min' || name === 'sum') && A.length === 2 && ln !== 'Boolean' && ln !== 'Character') return mathCall(name === 'sum' ? '$sum' : name, n, p);
        }
        if (ln === 'Map' && name === 'of') {
          if (A.length % 2) throw JErr('Map.of(ключ1, значение1, ключ2, значение2 …) — чётное число аргументов', n.line);
          const R = A.map(a => val(a));
          let kt = R[0] ? boxed(R[0].t) : null, vt = R[1] ? boxed(R[1].t) : null;
          if (want && genArgs(want).length === 2) { kt = genArgs(want)[0]; vt = genArgs(want)[1]; }
          const t = 'Map<' + (kt || 'Object') + ',' + (vt || 'Object') + '>';
          return { c: tagKinds('$A.Map.of([' + R.map((r, i) => conv(r, i % 2 ? vt : kt, n.line, 'call')).join(', ') + '])', t), t };
        }
        if (ln === 'Arrays' && name === 'stream' && A.length >= 1) {
          const R = val(A[0]), et = R.t && isArrT(R.t) ? arrElem(R.t) : null;
          const st = et === 'int' ? 'IntStream' : et === 'double' ? 'DoubleStream' : et === 'long' ? 'LongStream' : 'Stream<' + (et || 'Object') + '>';
          return { c: '$A.Arrays.stream(' + [R.c].concat(A.slice(1).map(a => conv(val(a), 'int', n.line, 'call'))).join(', ') + ')', t: st };
        }
        const e = lib().get(ln);
        if (!e) throw JErr(ln + '.' + name + ' — нет такого', n.line);
        if (e.world && ln === 'Instance' && (name === 'create' || name === 'new')) { const R = A.map(a => val(a)); return { c: '$G.Instance.new(' + R.map(worldArg).join(', ') + ')', t: 'Part' }; }
        const sigs = libCands(ln, name, true);
        if (!sigs.length) {
          if (e.m.has(name)) throw JErr(ln + '.' + name + ' — не static: нужен объект ' + ln, n.line);
          if (e.mcAny) return { c: '$A.' + jsLib(ln) + '.' + name + '(' + A.map(a => worldArg(val(a))).join(', ') + ')', t: null };
          throw JErr(ln + '.' + name + '(…) — такого метода нет' + libHint(e, name), n.line);
        }
        const r = choose(sigs, A, n.line, ln + '.' + name, want);
        let code = '$A.' + jsLib(ln) + '.' + r.k.js + '(' + r.codes.join(', ') + ')';
        if (e.world && ln !== 'Vector3' && ln !== 'CFrame') code = '$G.' + ln + '.' + r.k.js + '(' + r.codes.join(', ') + ')';
        let t = r.t;
        if (t === 'void') return { c: code, t };
        if (e.world && t && /^List</.test(t)) code = '$.jlist(' + code + ')';
        return { c: tagKinds(code, t), t };
      }
      // Math: тип результата зависит от типов аргументов (abs, max, min, round)
      function mathCall(name, n, forceT){
        const A = n.args, R = A.map(a => val(a));
        const T1 = () => { if (R.length !== 1) throw JErr('Math.' + name + '(x) — один аргумент', n.line); return prim(R[0].t); };
        const T2 = () => { if (R.length !== 2) throw JErr('Math.' + name + '(a, b) — два аргумента', n.line); if (forceT) return forceT; return NUMS.has(prim(R[0].t)) && NUMS.has(prim(R[1].t)) ? promo(R[0].t, R[1].t) : 'double'; };
        const cv = (r, t) => NUMS.has(prim(r.t)) ? toT(r, t, n.line) : '$.toNum(' + r.c + ', ' + JSON.stringify(t) + ')';
        switch (name) {
          case 'abs': case 'absExact': { const t = T1(); const T = t === 'long' ? 'long' : t === 'double' || t === 'float' ? t : 'int'; const a = cv(R[0], T); if (name === 'absExact') return { c: '$.absExact(' + a + ', ' + JSON.stringify(T) + ')', t: T }; return { c: T === 'int' ? '(Math.abs(' + a + ') | 0)' : T === 'long' ? '$.labs(' + a + ')' : 'Math.abs(' + a + ')', t: T }; }
          case 'max': case 'min': { const T = T2(); const a = cv(R[0], T), b = cv(R[1], T); return { c: T === 'long' ? '$.l' + name + '(' + a + ', ' + b + ')' : 'Math.' + name + '(' + a + ', ' + b + ')', t: T }; }
          case '$sum': { const T = T2(); return arith('+', R[0], R[1], T, n.line); }
          case 'round': { const t = T1(); if (t === 'float') return { c: '$.roundf(' + cv(R[0], 'float') + ')', t: 'int' }; return { c: '$.roundd(' + cv(R[0], 'double') + ')', t: 'long' }; }
          case 'signum': { const t = T1(); const T = t === 'float' ? 'float' : 'double'; return { c: 'Math.sign(' + cv(R[0], T) + ')', t: T }; }
          case 'floorDiv': case 'floorMod': case 'ceilDiv': case 'addExact': case 'subtractExact': case 'multiplyExact': {
            const T = T2() === 'long' ? 'long' : 'int';
            return { c: '$.' + name + '(' + cv(R[0], T) + ', ' + cv(R[1], T) + ', ' + JSON.stringify(T) + ')', t: name === 'floorMod' && T === 'long' && prim(R[1].t) !== 'long' ? 'int' : T };
          }
          case 'negateExact': case 'incrementExact': case 'decrementExact': { const t = T1(); const T = t === 'long' ? 'long' : 'int'; return { c: '$.' + name + '(' + cv(R[0], T) + ', ' + JSON.stringify(T) + ')', t: T }; }
          case 'toIntExact': return { c: '$.toIntExact(' + cv(R[0], 'long') + ')', t: 'int' };
          case 'clamp': { if (R.length !== 3) throw JErr('Math.clamp(x, min, max)', n.line); const ts = R.map(r => prim(r.t)); const T = ts.some(x => x === 'double' || x === 'float') ? (ts.some(x => x === 'double') ? 'double' : 'float') : ts[0] === 'long' && ts[1] !== 'long' ? 'int' : ts.some(x => x === 'long') ? 'long' : 'int'; return { c: '$.clamp(' + R.map(r => cv(r, T === 'int' && prim(r.t) === 'long' ? 'long' : T)).join(', ') + ', ' + JSON.stringify(T) + ')', t: T }; }
          case 'random': if (R.length) throw JErr('Math.random() — без аргументов (даёт число от 0 до 1)', n.line); return { c: 'Math.random()', t: 'double' };
          case 'toRadians': return { c: '(' + cv(R[0], 'double') + ' * (Math.PI / 180))', t: 'double' };
          case 'toDegrees': return { c: '(' + cv(R[0], 'double') + ' * (180 / Math.PI))', t: 'double' };
          case 'rint': return { c: '$.rint(' + cv(R[0], 'double') + ')', t: 'double' };
          case 'ulp': return { c: '$.ulp(' + cv(R[0], 'double') + ')', t: 'double' };
          case 'fma': if (R.length !== 3) throw JErr('Math.fma(a, b, c) — три аргумента', n.line); return { c: '(' + cv(R[0], 'double') + ' * ' + cv(R[1], 'double') + ' + ' + cv(R[2], 'double') + ')', t: 'double' };
        }
        const D = { sqrt: 1, cbrt: 1, floor: 1, ceil: 1, sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1, exp: 1, log: 1, log10: 1, sinh: 1, cosh: 1, tanh: 1, log1p: 1, expm1: 1, pow: 2, atan2: 2, hypot: 2 };
        if (D[name]) { if (R.length !== D[name]) throw JErr('Math.' + name + ' ждёт ' + D[name] + ' аргумент(а)', n.line); return { c: 'Math.' + name + '(' + R.map(r => cv(r, 'double')).join(', ') + ')', t: 'double' }; }
        return null;
      }
      // подсказка типа коллекции для печати: List<Double> печатает 5.0, а не 5
      const kindOf = t => { const p = prim(t); return p === 'double' ? 'D' : p === 'float' ? 'F' : null; };
      const COLLS = new Set(['List', 'ArrayList', 'LinkedList', 'Set', 'HashSet', 'LinkedHashSet', 'TreeSet', 'Collection', 'Deque', 'ArrayDeque', 'Queue', 'PriorityQueue', 'Optional', 'Stack', 'Vector', 'SortedSet', 'NavigableSet', 'SequencedCollection', 'CopyOnWriteArrayList']);
      function tagKinds(code, t){
        if (!t) return code;
        const g = genName(t), a = genArgs(t);
        if (!a.length) return code;
        if (/Map$/.test(g)) { const k = kindOf(a[0]), v = kindOf(a[1]); return k || v ? '$.kd(' + code + ', ' + JSON.stringify(k) + ', ' + JSON.stringify(v) + ')' : code; }
        if (COLLS.has(g)) { const k = kindOf(a[0]); return k ? '$.kd(' + code + ', ' + JSON.stringify(k) + ')' : code; }
        return code;
      }
      // ── лямбды: x -> …, (a, b) -> { … } ──
      let FID = 0, FNS = [];
      function newFn(o){ const F = Object.assign({ id: ++FID, direct: false, edges: new Set(), retTypes: [], capSelf: null }, o); if (PASS === 1) FNS.push(F); return F; }
      function lambdaX(n, want){
        const fi = fiOf(want);
        if (want && !unk(want) && !fi) throw JErr('Лямбда здесь не подходит: ' + shortT(want) + ' — не функциональный интерфейс (нужен интерфейс с одним методом)', n.line);
        if (fi && !fi.any && fi.ps.length !== n.params.length) throw JErr('Лямбда с ' + n.params.length + ' параметр(ами), а ' + shortT(want) + ' ждёт ' + fi.ps.length, n.line);
        const up = FN, save = [FN, SC, PEND, LOOPS, STL];
        FN = newFn({ kind: 'lambda', up, node: n, root: up ? (up.root || up) : null, cls: up ? up.cls : null, isStatic: up ? up.isStatic : true, self: up ? up.self : null,
          ret: fi && !fi.any ? fi.ret : null, tps: up ? up.tps : null, gen: PASS === 2 && GENS.has(n), name: fi && !fi.any ? fi.name : '' });
        if (fi && fi.user) FN.userFam = famOf(fi.ov);
        if (FN.gen && FN.self === 'this') FN.self = capture(up);
        LOOPS = []; push();
        const ps = n.params.map((p, i) => { let ty = p.ty ? canon(p.ty, FN.cls, n.line) : fi && !fi.any ? fi.ps[i] : null; if (ty && TVAR.test(ty) && !isTVName(ty)) ty = null; return declare(p.name, ty, n.line, { param: true }).js; });
        let body, bt;
        if (n.body.s === 'block') { body = fnBody(n.body); bt = FN.retTypes.length ? FN.retTypes[0] : 'void'; }
        else {
          PEND = []; STL = n.body.line;
          const voidCtx = fi && !fi.any && fi.ret === 'void';
          const rt = FN.ret && FN.ret !== 'void' && !unk(FN.ret) ? FN.ret : null;
          const R = voidCtx ? exprStmtR(n.body) : val(n.body, rt);
          bt = R.t;
          const c = rt ? conv(R, rt, n.line, 'call') : R.c;
          const dl = PEND.length ? 'let ' + [...new Set(PEND)].join(', ') + '; ' : '';
          body = voidCtx ? '{ ' + dl + c + '; }' : (dl || FN.gen ? '{ ' + dl + lead('return ', c) + '; }' : '(' + c + ')');
        }
        const F = FN;
        pop(); [FN, SC, PEND, LOOPS, STL] = save;
        let code = F.gen ? 'function* (' + ps.join(', ') + ') ' + body : '((' + ps.join(', ') + ') => ' + body + ')';
        if (fi && fi.user) code = '$.lam(' + fi.user.js + ', ' + JSON.stringify(fi.js) + ', ' + code + ')';
        else if (F.gen) code = '$.cofn(' + code + ', $)';
        return { c: code, t: want && !unk(want) ? want : 'AnyFn', bt };
      }
      // ── ссылки на методы: String::length, System.out::println, Dog::new, int[]::new, this::f ──
      let MRN = 0;
      function mrefX(n, want){
        const fi = fiOf(want), k = fi && !fi.any ? fi.ps.length : null;
        let tyName = null;
        if (n.o.k === 'tyexpr') tyName = canon(n.o.ty, FN && FN.cls, n.line);
        else if (n.o.k === 'id' || n.o.k === 'mem') { const R0 = raw(n.o); if (R0.ty) tyName = R0.t; else if (R0.pkg) throw JErr('«' + R0.pkg + '» не найдено', n.line); }
        const ps = [];
        if (!n.$syn) n.$syn = new Map();
        const syn = (args, body) => { const key = args.length + '|' + JSON.stringify(body, (k, v) => k === 'line' || k === '$syn' ? undefined : v); let s = n.$syn.get(key); if (!s) { s = { k: 'lambda', params: args.map(nm => ({ name: nm, ty: null })), body, line: n.line, $mref: true }; n.$syn.set(key, s); } return s; };
        const P = i => '$p' + i + '_' + (n.$id || (n.$id = ++MRN));
        const pid = i => ({ k: 'id', name: P(i), line: n.line });
        let arity = k;
        if (tyName) {
          if (n.name === 'new') {
            if (isArrT(tyName)) { const node = syn([P(0)], { k: 'newarr', ty: arrElem(tyName).replace(/(\[\])+$/, ''), dims: [pid(0)], extra: (arrElem(tyName).match(/\[\]/g) || []).length, init: null, line: n.line }); return lambdaX(node, want || 'IntFunction<' + tyName + '>'); }
            if (arity === null) { const u = userC(tyName); arity = u ? (u.ctors.length === 1 ? u.ctors[0].params.length : 0) : 0; }
            for (let i = 0; i < arity; i++) ps.push(P(i));
            const node = syn(ps, { k: 'new', ty: tyName, args: ps.map((x, i) => pid(i)), body: null, outer: null, line: n.line });
            return lambdaX(node, want);
          }
          // static или «несвязанный» метод объекта
          const u = userC(tyName), e = !u && libE(tyName);
          const stA = u ? userOvs(u, n.name, true).map(o => o.params.length) : e ? (libCands(tyName, n.name, true).map(s => s.ps.length)) : [];
          const inA = u ? userOvs(u, n.name, false).filter(o => !o.obj || OBJ_METHODS.has(n.name)).map(o => o.params.length) : (libCands(tyName, n.name, false).map(s => s.ps.length).concat(tyName === 'String' && n.name === 'length' ? [0] : []).concat(OBJ_METHODS.has(n.name) ? [n.name === 'equals' ? 1 : 0] : []));
          let isStatic;
          if (arity !== null) isStatic = stA.includes(arity) || (stA.some(a => a < arity) && libCands(tyName, n.name, true).some(s => s.va)) ? true : inA.includes(arity - 1) ? false : stA.length > 0;
          else { isStatic = stA.length > 0 && !inA.length ? true : !stA.length; if (isStatic && !stA.length && !inA.length) throw JErr('У ' + tyName + ' нет метода ' + n.name, n.line); arity = isStatic ? (stA[0] || 0) : (inA[0] || 0) + 1; }
          if (!stA.length && !inA.length) throw JErr('У ' + shortT(tyName) + ' нет метода ' + n.name, n.line);
          for (let i = 0; i < arity; i++) ps.push(P(i));
          let body;
          if (isStatic) body = { k: 'call', f: { k: 'mem', o: n.o.k === 'tyexpr' ? n.o : n.o, name: n.name, line: n.line }, args: ps.map((x, i) => pid(i)), line: n.line };
          else { body = { k: 'call', f: { k: 'mem', o: pid(0), name: n.name, line: n.line }, args: ps.slice(1).map((x, i) => pid(i + 1)), line: n.line }; }
          const node = syn(ps, body);
          if (!isStatic && (!fi || fi.any || unk(fi.ps[0]))) node.params[0].ty = tyName.replace(/<.*$/, '') === tyName ? tyName : tyName;
          return lambdaX(node, want);
        }
        // связанный: obj::m, this::m, super::m, System.out::println
        if (arity === null) arity = 1;
        for (let i = 0; i < arity; i++) ps.push(P(i));
        if (n.o.k === 'this' || n.o.k === 'super') {
          const body = { k: 'call', f: { k: 'mem', o: n.o, name: n.name, line: n.line }, args: ps.map((x, i) => pid(i)), line: n.line };
          return lambdaX(syn(ps, body), want);
        }
        const R = val(n.o);
        const tv = '$mr' + (++MRN);
        if (PEND) PEND.push(tv);
        push();
        SC.v.set(tv, { type: R.t, js: tv, name: tv, final: true, fn: FN });
        const body = { k: 'call', f: { k: 'mem', o: { k: 'id', name: tv, line: n.line }, name: n.name, line: n.line }, args: ps.map((x, i) => pid(i)), line: n.line };
        const L = lambdaX(syn(ps, body), want);
        pop();
        return { c: '(' + tv + ' = ' + R.c + ', ' + L.c + ')', t: L.t, bt: L.bt };
      }
      // ── new ──
      function inferDiamond(base, want, args){
        const u = userC(base), e = !u && libE(base);
        const tps = u ? u.tps : e ? e.tps : [];
        if (!tps.length) return base;
        const G = base + '<' + tps.join(',') + '>', map = {};
        if (want && !unk(want)) { const as = genName(want) === base ? G : asSuper(G, genName(want)); if (as) unify(as, want, map, tps); }
        if (tps.some(x => !map[x]) && args && args.length === 1) { const R = args[0]; if (R && R.t && !NUMS.has(R.t)) { const as = asSuper(R.t, 'Collection') || asSuper(R.t, 'Map'); if (as) { const gs = asSuper(G, genName(as)); if (gs) unify(gs, as, map, tps); } } }
        return tps.every(x => !map[x]) ? base : base + '<' + tps.map(x => map[x] || 'Object').join(',') + '>';
      }
      function newObj(n, want){
        if (n.outer) {   // outer.new Inner(…)
          const O = val(n.outer), oc = userC(O.t);
          if (!oc) throw JErr('x.new Класс() — x должен быть объектом своего класса', n.line);
          const ic = nestedOf(oc, genName(n.ty));
          if (!ic || !ic.inner) throw JErr(n.ty + ' — не внутренний класс ' + oc.name, n.line);
          return ctorCall(ic, ic.q, n, want, O.c);
        }
        const diamond = /<>$/.test(n.ty);
        let t = canon(diamond ? n.ty.slice(0, -2) : n.ty, FN && FN.cls, n.line);
        if (n.body) return anonNew(n, diamond ? inferDiamond(t, want) : t, want);
        const u = userC(t);
        if (u) {
          if (diamond) t = inferDiamond(t, want);
          if (u.iface) throw JErr('Нельзя создать интерфейс ' + u.name + ' через new — нужен класс (или анонимный класс: new ' + u.name + '() { … })', n.line);
          if (u.abstract) throw JErr('Нельзя создать абстрактный класс ' + u.name + ' — создай его наследника', n.line);
          if (u.kind === 'enum') throw JErr('Значения enum не создают через new: ' + u.name + '.ИМЯ', n.line);
          return ctorCall(u, t, n, want, null);
        }
        const g = genName(t), e = libE(t);
        if (NUMS.has(g) || g === 'boolean') throw JErr('new ' + g + '(…) — так нельзя: ' + g + ' — простой тип', n.line);
        if (!e) throw JErr('Нельзя создать ' + g + ' через new', n.line);
        if (e.iface) throw JErr('Нельзя создать интерфейс ' + g + ' через new' + (g === 'List' ? ' — пиши new ArrayList<>()' : g === 'Map' ? ' — пиши new HashMap<>()' : g === 'Set' ? ' — пиши new HashSet<>()' : g === 'Queue' || g === 'Deque' ? ' — пиши new ArrayDeque<>()' : ''), n.line);
        if (g === 'Thread') throw JErr('Потоков нет: new Thread(…) не поддерживается — жди через wait(сек) или task.spawn(() -> …)', n.line);
        const A = n.args;
        if (g === 'String') { const R = A.map(a => val(a)); if (!R.length) return { c: '""', t: 'String', nn: true }; if (R.length === 1 && R[0].t === 'String') return { c: '$.sn1(' + R[0].c + ')', t: 'String', nn: true }; return { c: '$.chars(' + R.map((r, i) => i ? conv(r, 'int', n.line, 'call') : r.c).join(', ') + ')', t: 'String', nn: true }; }
        if (g === 'StringBuilder' || g === 'StringBuffer') { if (A.length > 1) throw JErr('new StringBuilder(текст)', n.line); const R = A.length ? val(A[0]) : null; return { c: 'new $A.StringBuilder(' + (!R ? '' : NUMS.has(prim(R.t)) && prim(R.t) !== 'char' ? '' : strOf(R)) + ')', t: 'StringBuilder' }; }
        if (diamond) t = inferDiamond(g, want, A.length === 1 && !isPoly(A[0]) ? [val(A[0])] : null);
        if (e.world) {
          const R = A.map(a => val(a));
          if (g === 'Vector3' || g === 'CFrame') return { c: 'new $A.' + g + '(' + R.map(worldArg).join(', ') + ')', t: g };
          return { c: '$G.' + g + '.new(' + R.map(worldArg).join(', ') + ')', t: g };
        }
        const sigs = e.ctor.map(sg => { const map = {}; e.tps.forEach((x, i) => map[x] = genArgs(t)[i] || null); return { ps: sg.ps.map(p => subst(p, map)), va: sg.va, ret: t, mtps: [], sg, js: 'new' }; });
        if (!sigs.length) throw JErr('Нельзя создать ' + g + ' через new' + (g === 'Math' || g === 'Arrays' || g === 'Collections' ? ' — у него только static-методы: ' + g + '.метод(…)' : ''), n.line);
        const r = choose(sigs, A, n.line, 'new ' + g, null);
        return { c: tagKinds('new $A.' + jsLib(g) + '(' + r.codes.join(', ') + ')', t), t };
      }
      function ctorCall(u, t, n, want, outerCode){
        members(u); nameMethods(u);
        const map = {}; u.tps.forEach((x, i) => map[x] = genArgs(t)[i] || null);
        const cands = u.ctors.map((k, i) => ({ ps: k.params.map(p => subst(p.ty, map)), va: k.va, ret: t, mtps: [], ki: i, k }));
        const r = choose(cands, n.args, n.line, 'new ' + u.name, null);
        const ki = r.ambiguous ? -1 : r.k.ki;
        let pre = '';
        if (u.inner) pre = (outerCode || instExpr(u.outer, n.line)) + ', ';
        const code = 'new ' + ownerJs(u) + '(' + pre + ki + (r.codes.length ? ', ' + r.codes.join(', ') : '') + ')';
        return { c: tagKinds(code, t), t };
      }
      // анонимный класс: new Runnable() { public void run() { … } } — класс-выражение на месте (видит переменные вокруг)
      function anonNew(n, t, want){
        const d = { kind: 'class', name: '', members: n.body.members, mods: new Set(), line: n.line, end: n.body.end, impl: [], tps: null, annos: [] };
        const outerC = FN ? FN.cls : null;
        const c = collect(d, outerC, { anon: true });
        const u = userC(t), e = !u && libE(t);
        if (u && u.iface) c.ifaces.push(t);
        else if (u) { if (u.d.mods.has('final')) throw JErr('Класс ' + u.name + ' — final: от него наследовать нельзя', n.line); if (u.kind === 'enum' || u.kind === 'record') throw JErr('От ' + u.kind + ' наследовать нельзя', n.line); c.base = t; c.baseC = u; }
        else if (e && e.iface) c.ifaces.push(t);
        else if (e && (e.extOk || EXC_LIST.some(x => x[0] === e.name) || e.name === 'Object' || e.name === 'Script')) { c.libBase = e.name; c.libBaseT = t; if (EXC_LIST.some(x => x[0] === e.name)) c.exc = true; if (e.name === 'Script') c.script = true; if (e.extOk) c.mc = true; }
        else if (e && e.name === 'Thread') throw JErr('Потоков нет: new Thread() { … } не поддерживается', n.line);
        else throw JErr('Анонимный класс от ' + shortT(t) + ' не поддерживается', n.line);
        if (!FN || !FN.isStatic) c.capSelf = FN ? capture(FN) : null;
        c.declCls = outerC;
        for (const m of d.members) if (m.m === 'ctor') throw JErr('У анонимного класса нет конструктора (данные — через аргументы new Базовый(…) или поля)', m.line);
        members(c); nameMethods(c);
        c.ctors = [];   // аргументы — конструктору базового класса
        const code = classCode(c, true);
        // конструктор базового класса
        let args = '';
        if (c.baseC) { members(c.baseC); const map = {}; c.baseC.tps.forEach((x, i) => map[x] = genArgs(t)[i] || null); const cands = c.baseC.ctors.map((k, i) => ({ ps: k.params.map(p => subst(p.ty, map)), va: k.va, ret: t, mtps: [], ki: i })); const r = choose(cands, n.args, n.line, 'new ' + c.baseC.name, null); args = [r.ambiguous ? -1 : r.k.ki].concat(r.codes).join(', '); if (c.baseC.inner) args = instExpr(c.baseC.outer, n.line) + ', ' + args; }
        else if (c.libBase && c.libBase !== 'Object') { const sigs = (libE(c.libBaseT || c.libBase).ctor || []).map(sg => ({ ps: sg.ps, va: sg.va, ret: t, mtps: [] })); if (sigs.length) { const r = choose(sigs, n.args, n.line, 'new ' + c.libBase, null); args = r.codes.join(', '); } }
        else if (n.args.length) throw JErr('Интерфейс ' + shortT(t) + ' без конструктора: new ' + shortT(t) + '() { … } — без аргументов', n.line);
        return { c: 'new (' + code + ')(' + args + ')', t: t || 'Object' };
      }
      // ── массивы ──
      function newArr(n){
        const base = canon(n.ty, FN && FN.cls, n.line), total = n.dims.length + n.extra, full = base + '[]'.repeat(total);
        if (n.init) return arrLit(n.init, full);
        const S = n.dims.map(d => { const R = val(d); const p = prim(R.t); if (R.t && !isInt32(p) && p !== 'char' && !unk(R.t)) throw JErr('Размер массива — целое число (int)' + (p === 'long' ? ': нужно (int) …' : ''), n.line); return NUMS.has(p) ? toT(R, 'int', n.line) : '$.toNum(' + R.c + ', "int")'; });
        if (S.length === 1) return { c: '$.na(' + JSON.stringify(n.extra ? 'L' : arrTag(base)) + ', ' + S[0] + ')', t: full };
        return { c: '$.nam(' + JSON.stringify(arrTag(base)) + ', [' + S.join(', ') + '], ' + n.extra + ')', t: full };
      }
      function arrLit(init, t){
        if (!isArrT(t)) throw JErr('Список { … } — только для массива', init.line);
        const et = arrElem(t);
        const items = init.items.map(x => x.k === 'arrinit' ? (isArrT(et) ? arrLit(x, et).c : (() => { throw JErr('Лишние { } — элемент ' + et + ' не массив', x.line); })()) : conv(val(x, et), et, x.line, 'asg'));
        return { c: arrCode(et, items), t };
      }

      // ── инструкции ──
      const LOOPISH = new Set(['while', 'do', 'for', 'foreach', 'switch', 'label', 'try']);
      function fnBody(b){
        push();
        const c = b.body.map(s => stmtCode(s)).join('');
        pop();
        const pro = FN.capSelf ? 'const ' + FN.capSelf + ' = this; ' : '';
        return '{' + pro + c + mark(b.end) + '}';
      }
      function blockCode(b){ push(); const c = b.body.map(s => stmtCode(s)).join(''); pop(); return '{' + c + mark(b.end) + '}'; }
      function stmtCode(s, emb){
        const saveP = PEND, saveL = STL; PEND = []; STL = s.line;
        const code = stmtInner(s);
        STL = saveL;
        const names = [...new Set(PEND)]; PEND = saveP;
        const decl = names.length ? 'let ' + names.join(', ') + '; ' : '';
        if (decl && emb) return mark(s.line) + '{' + decl + code + '}';
        if (emb && (s.s === 'var' || s.s === 'ltype')) return mark(s.line) + '{' + code + '}';
        return mark(s.line) + decl + code;
      }
      let LABEL = null;   // метка следующего цикла (label: for …)
      function loopBody(s, kind){ const lab = LABEL; LABEL = null; LOOPS.push({ label: lab, kind }); const b = stmtCode(s, true); LOOPS.pop(); return b; }
      function stmtInner(s){
        switch (s.s) {
          case 'block': return blockCode(s);
          case 'empty': return ';';
          case 'var': return varCode(s) + ';';
          case 'ltype': return localType(s.decl);
          case 'expr': return exprStmt(s.e) + ';';
          case 'if': return 'if (' + condCode(s.c) + ') ' + stmtCode(s.a, true) + (s.b ? ' else ' + stmtCode(s.b, true) : '');
          case 'while': { const c = condCode(s.c); return 'while (' + c + ') ' + loopBody(s.body, 'loop'); }
          case 'do': { const lab = LABEL; LABEL = null; LOOPS.push({ label: lab, kind: 'loop' }); const b = stmtCode(s.body, true); LOOPS.pop(); const c = condCode(s.c); return 'do ' + b + ' while (' + c + ');'; }
          case 'for': {
            push();
            const lab = LABEL; LABEL = null;
            const init = Array.isArray(s.init) ? s.init.map(e => exprStmt(e)).join(', ') : s.init ? varCode(s.init) : '';
            const c = s.c ? condCode(s.c) : '';
            const upd = s.upd.map(e => exprStmt(e)).join(', ');
            LOOPS.push({ label: lab, kind: 'loop' });
            const b = stmtCode(s.body, true);
            LOOPS.pop(); pop();
            return 'for (' + init + '; ' + c + '; ' + upd + ') ' + b;
          }
          case 'foreach': return foreachCode(s);
          case 'switch': return switchStmt(s);
          case 'label': {
            if (LOOPS.some(l => l.label === s.label)) throw JErr('Метка «' + s.label + '» уже есть снаружи', s.line);
            const isLoop = ['while', 'do', 'for', 'foreach'].includes(s.body.s);
            if (isLoop) { LABEL = s.label; const saveP = PEND; PEND = []; const inner = stmtInner(s.body); const names = [...new Set(PEND)]; PEND = saveP; LABEL = null; return (names.length ? '{let ' + names.join(', ') + '; ' : '') + jsName(s.label) + ': ' + inner + (names.length ? '}' : ''); }
            LOOPS.push({ label: s.label, kind: 'block' });
            const b = stmtCode(s.body, true);
            LOOPS.pop();
            return jsName(s.label) + ': ' + b;
          }
          case 'break': {
            if (s.label) { if (!LOOPS.some(l => l.label === s.label)) throw JErr('Нет метки «' + s.label + '» для break', s.line); return 'break ' + jsName(s.label) + ';'; }
            const top = [...LOOPS].reverse().find(l => l.kind === 'loop' || l.kind === 'switch' || l.kind === 'swl');
            if (!top) throw JErr('break — только в цикле или switch', s.line);
            if (top.kind === 'swl') return 'break ' + top.js + ';';
            return 'break;';
          }
          case 'continue': {
            if (s.label) { const l = LOOPS.find(x => x.label === s.label); if (!l) throw JErr('Нет метки «' + s.label + '» для continue', s.line); if (l.kind !== 'loop') throw JErr('continue ' + s.label + ' — метка должна стоять у цикла', s.line); return 'continue ' + jsName(s.label) + ';'; }
            if (!LOOPS.some(l => l.kind === 'loop')) throw JErr('continue — только в цикле', s.line);
            return 'continue;';
          }
          case 'return': {
            if (YIELDS.length && YIELDS[YIELDS.length - 1].fn === FN) throw JErr('return внутри switch-выражения нельзя (там yield значение;)', s.line);
            if (!FN) throw JErr('return здесь нельзя', s.line);
            const rt = FN.ret;
            if (!s.e) { if (rt && rt !== 'void' && FN.kind !== 'lambda' && FN.kind !== 'main') throw JErr('Метод должен вернуть значение (' + shortT(rt) + '): return значение;', s.line); return 'return;'; }
            if (FN.kind === 'ctor' || FN.kind === 'init' || FN.kind === 'clinit') throw JErr('В конструкторе и блоке инициализации return без значения', s.line);
            if (rt === 'void' && FN.kind !== 'lambda') throw JErr('Метод void ничего не возвращает: пиши просто return;', s.line);
            if (rt === 'void' && FN.kind === 'lambda') throw JErr('Эта лямбда ничего не возвращает (void): убери значение у return', s.line);
            const R = val(s.e, rt && !unk(rt) ? rt : null);
            if (FN.kind === 'lambda') FN.retTypes.push(R.isNull ? null : R.t);
            return lead('return ', rt && rt !== 'void' && !unk(rt) ? conv(R, rt, s.line, 'asg') : R.c) + ';';
          }
          case 'throw': {
            const R = val(s.e);
            if (R.t && !unk(R.t) && !R.isNull && !isThrowT(R.t)) throw JErr('throw — только исключение (new RuntimeException("…")), а здесь ' + shortT(R.t), s.line);
            return lead('throw ', '$.thr(' + R.c + ')') + ';';
          }
          case 'try': return tryCode(s);
          case 'yield': {
            const Y = YIELDS[YIELDS.length - 1];
            if (!Y || Y.fn !== FN) throw JErr('yield — только внутри switch-выражения (int x = switch (…) { case … -> { yield 5; } })', s.line);
            const R = val(s.e, Y.t);
            Y.types.push(R.isNull ? null : R.t);
            return lead('return ', Y.t ? conv(R, Y.t, s.line, 'asg') : R.c) + ';';
          }
          case 'assert': { val(s.c); if (s.m) val(s.m); return ';'; }   // в Java проверки assert по умолчанию выключены
          case 'ctorcall': throw JErr(s.kind + '(…) — только первой строкой конструктора', s.line);
        }
        throw JErr('Эта инструкция не поддерживается', s.line);
      }
      const isThrowT = t => !!t && (genName(t) === 'Throwable' || supers(t).some(x => genName(x) === 'Throwable'));
      function defaultInit(t){ if (!t) return ''; const p = t; if (p === 'long') return ' = 0n'; if (NUMS.has(p) && p !== 'char') return ' = 0'; if (p === 'char') return ' = "\\0"'; if (p === 'boolean') return ' = false'; return ' = null'; }
      function varCode(s){
        const isVar = s.ty === 'var';
        const parts = s.decls.map(d => {
          let t = isVar ? null : canon(d.ty, FN && FN.cls, d.line);
          if (t === 'void') throw JErr('Переменная не может быть void', d.line);
          let init = null;
          if (d.init) {
            if (d.init.k === 'arrinit') { if (isVar) throw JErr('var x = { … } нельзя — напиши тип: int[] x = { … }', d.line); init = arrLit(d.init, t).c; }
            else {
              const R = val(d.init, t);
              if (isVar) {
                if (R.isNull) throw JErr('var x = null — так нельзя: напиши тип (String x = null;)', d.line);
                if (d.init.k === 'lambda' || d.init.k === 'mref') throw JErr('var и лямбда вместе нельзя: напиши тип (Runnable r = () -> …;)', d.line);
                t = R.t;
              }
              init = conv(R, t, d.line, 'asg');
            }
          } else if (isVar) throw JErr('У var нужно значение: var x = …;', d.line);
          const v = declare(d.name, t, d.line, { final: s.fin, inited: !!d.init });
          return mark(d.line) + v.js + (init !== null ? ' = ' + init : defaultInit(t));
        });
        return 'let ' + parts.join(', ');
      }
      // значение как инструкция: только вызов, присваивание, ++/--, new
      function exprStmtR(e){
        if (e.paren) throw JErr('Это выражение ничего не делает', e.line);
        if (e.k === 'post') return incX(e.e, e.op, false, e.line, true);
        if (e.k === 'un' && (e.op === '++' || e.op === '--')) return incX(e.e, e.op, true, e.line, true);
        if (e.k === 'asg' || e.k === 'call' || e.k === 'new') return ex(e);
        if (e.k === 'bin' && e.op === '==') throw JErr('a == b ничего не делает — может, нужно присваивание a = b?', e.line);
        if (e.k === 'id' || e.k === 'mem') throw JErr('Одно имя — не инструкция: может, забыты скобки () у вызова метода?', e.line);
        if (e.k === 'lambda') throw JErr('Лямбда сама по себе ничего не делает — сохрани её в переменную или передай в метод', e.line);
        throw JErr('Это выражение ничего не делает — инструкцией может быть вызов метода, присваивание, ++ или --', e.line);
      }
      function exprStmt(e){
        const R = exprStmtR(e);
        let c = R.c;
        if (/^(\{|function\b|class\b|let\b)/.test(c.replace(LEADRE, ''))) c = '(' + c + ')';
        return c;
      }
      function foreachCode(s){
        const C = val(s.coll);
        const ct = C.t;
        if (ct && (NUMS.has(ct) || ct === 'boolean' || ct === 'String')) throw JErr('for (x : …) — справа нужен массив или коллекция' + (ct === 'String' ? ' (по символам строки: for (char c : s.toCharArray()))' : ''), s.line);
        const et = elemOf(ct);
        if (ct && !et && !unk(ct) && !isArrT(ct) && /Map/.test(genName(ct))) throw JErr('Map нельзя перебрать напрямую: map.keySet(), map.values() или map.entrySet()', s.line);
        const lab = LABEL; LABEL = null;
        push();
        let vt = s.ty === 'var' ? (et && TVAR.test(et) && !isTVName(et) ? null : et) : canon(s.ty, FN && FN.cls, s.line);
        if (s.ty !== 'var' && et && !unk(et) && vt && !assignable(et, vt) && !(UNBOX[et] && NUMS.has(vt) && widens(UNBOX[et], vt)) && !(NUMS.has(et) && UNBOX[vt] && UNBOX[vt] === et)) throw JErr('Элементы — ' + shortT(et) + ', а переменная цикла — ' + shortT(vt), s.line);
        const v = declare(s.name, vt, s.line, {});
        const src = ct && (isArrT(ct) || libE(ct)) && !userC(ct) ? C.c : '$.it(' + C.c + ')';
        let head, pro = '';
        const need = et && vt && et !== vt && (NUMS.has(vt) || vt === 'boolean');
        if (need) { const tv = '$f' + (++TMP); head = 'for (const ' + tv + ' of ' + src + ') '; pro = 'let ' + v.js + ' = ' + conv({ c: tv, t: et }, vt, s.line, 'asg') + '; '; }
        else head = 'for (let ' + v.js + ' of ' + src + ') ';
        LOOPS.push({ label: lab, kind: 'loop' });
        const b = stmtCode(s.body, true);
        LOOPS.pop(); pop();
        return (lab ? '' : '') + head + '{' + pro + b + '}';
      }
      // ── switch: константы — обычный switch JS; шаблоны и null — цепочка if ──
      let YIELDS = [];
      function caseConst(lab, R, st, ec, line){
        if (ec && lab.e.k === 'id' && ec.fld.has(lab.e.name)) return ec.js + '[' + fkey(lab.e.name) + ']';
        if (ec) { const E = val(lab.e, st); return E.c; }
        const E = val(lab.e, st);
        const sp = prim(st), ep = prim(E.t);
        if (sp === 'char' && ep === 'int' && E.lit) return JSON.stringify(CH(E.v));
        if (sp === 'int' && ep === 'char' && E.lit) return String(E.v.charCodeAt(0));
        if (st && E.t && !unk(st) && !unk(E.t) && sp !== ep && !(isInt32(sp) && isInt32(ep)) && !(UNBOX[st] && UNBOX[st] === ep)) throw JErr('case ' + (E.lit ? JSON.stringify(E.v) : '') + ': тип ' + shortT(E.t) + ' не подходит к switch по ' + shortT(st), line);
        return isInt32(sp) && ep === 'char' ? '$.ord(' + E.c + ')' : E.c;
      }
      function selCode(R, line){
        const t = R.t;
        if (t === 'long' || t === 'Long' || t === 'float' || t === 'double' || t === 'boolean') throw JErr('switch по ' + t + ' нельзя (можно int, char, String, enum или объект с шаблонами)', line);
        if (UNBOX[t]) return '$.ub(' + R.c + ')';
        if (t === 'String' || userC(t)) return '$.nsw(' + R.c + ')';
        return R.c;
      }
      const simpleCases = sw => sw.cases.every(c => !c.guard && c.labels.every(l => l.p === 'const' || (l.p === 'default')));
      function switchStmt(s){
        const R = val(s.e), st = R.t, ec = userC(st) && userC(st).kind === 'enum' ? userC(st) : null;
        const lab = LABEL; LABEL = null;
        if (simpleCases(s)) {
          const sel = selCode(R, s.line);
          LOOPS.push({ label: lab, kind: 'switch' }); push();
          let out = 'switch (' + sel + ') {';
          const seen = new Set();
          for (const c of s.cases) {
            for (const l of c.labels) {
              if (l.p === 'default') { out += mark(l.line) + 'default:'; continue; }
              const k = caseConst(l, R, st, ec, l.line);
              if (seen.has(k)) throw JErr('case ' + k.replace(/^.*\["#?|"\]$/g, '') + ' уже есть в этом switch', l.line);
              seen.add(k);
              out += mark(l.line) + 'case ' + k + ':';
            }
            out += ' ' + caseBody(c, s.arrow, !!s.isExpr) + (s.arrow ? ' break;' : '');
          }
          pop(); LOOPS.pop();
          return (lab ? jsName(lab) + ': ' : '') + out + '}';
        }
        const sv = '$v' + (++TMP), L = lab ? jsName(lab) : '$s' + TMP;
        const hasNull = s.cases.some(c => c.labels.some(l => l.p === 'null'));
        LOOPS.push({ label: lab, kind: 'swl', js: L }); push();
        let out = L + ': { const ' + sv + ' = ' + (hasNull ? R.c : '$.nsw(' + R.c + ')') + '; ', first = true, dflt = null;
        for (const c of s.cases) {
          if (!s.arrow && c.body.list.length === 0) throw JErr('С шаблонами case не «проваливается» дальше: у каждого case свой код', c.line);
          const conds = [];
          let isDef = false;
          for (const l of c.labels) { if (l.p === 'default') { isDef = true; continue; } conds.push(patCode(l, sv, st, l.line)); }
          let cond = conds.join(' || ');
          if (c.guard) cond = '(' + cond + ') && ' + condCode(c.guard);
          const body = caseBody(c, s.arrow, !!s.isExpr);
          if (isDef && !conds.length) { dflt = body; continue; }
          out += (first ? '' : 'else ') + 'if (' + (isDef ? 'true' : cond) + ') ' + body + ' ';
          first = false;
        }
        if (dflt) out += (first ? '' : 'else ') + dflt;
        pop(); LOOPS.pop();
        return out + '}';
      }
      function caseBody(c, arrow, isExpr){
        const b = c.body;
        if (b.kind === 'block') return blockCode(b.b);
        if (b.kind === 'throw') return '{ ' + lead('throw ', '$.thr(' + val(b.e).c + ')') + '; }';
        if (b.kind === 'expr') return '{ ' + stmtCode({ s: isExpr ? 'yield' : 'expr', e: b.e, line: b.line }) + ' }';
        push(); const code = b.list.map(x => stmtCode(x)).join(''); pop();
        return '{' + code + '}';
      }
      function swX(n, want){
        const R = val(n.e), st = R.t, ec = userC(st) && userC(st).kind === 'enum' ? userC(st) : null;
        const sv = '$w' + (++TMP);
        if (PEND) PEND.push(sv);
        const simple = n.arrow && n.cases.every(c => c.body.kind === 'expr' || c.body.kind === 'throw');
        const pats = !simpleCases(n);
        let t = want && !unk(want) ? want : null;
        // тип результата — по веткам (если не задан)
        if (simple) {
          const arms = [];
          let dflt = null, hasDef = false;
          push();
          for (const c of n.cases) {
            const conds = [];
            let isDef = false;
            for (const l of c.labels) { if (l.p === 'default') { isDef = true; continue; } conds.push(pats ? patCode(l, sv, st, l.line) : '(' + sv + ' === ' + caseConst(l, R, st, ec, l.line) + ')'); }
            let cond = conds.join(' || ');
            if (c.guard) cond = '(' + cond + ') && ' + condCode(c.guard);
            const V = c.body.kind === 'throw' ? { c: '$.thr(' + val(c.body.e).c + ')', t: null, thr: true } : val(c.body.e, t);
            arms.push({ cond, V, isDef, line: c.line });
            if (isDef) hasDef = true;
          }
          pop();
          if (!t) { const ts = arms.filter(a => !a.V.thr && !a.V.isNull).map(a => a.V.t); t = ts.length ? ts.reduce((a, b) => a === b ? a : NUMS.has(prim(a)) && NUMS.has(prim(b)) ? promo(a, b) : unk(a) ? b : unk(b) ? a : assignable(a, b) ? b : assignable(b, a) ? a : 'Object') : null; }
          const conv2 = V => V.thr || !t ? V.c : (NUMS.has(t) ? toT(V, t, n.line) : V.c);
          let code = hasDef ? null : '$.swf(' + sv + ')';
          for (let i = arms.length - 1; i >= 0; i--) {
            const a = arms[i];
            if (a.isDef && !a.cond) { code = conv2(a.V); continue; }
            code = '(' + (a.isDef ? 'true' : a.cond) + ' ? ' + conv2(a.V) + ' : ' + (code || '$.swf(' + sv + ')') + ')';
          }
          return { c: '(' + sv + ' = ' + selCode(R, n.line) + ', ' + code + ')', t };
        }
        // ветки с блоками и yield: функция на месте
        const Y = { t, types: [], fn: FN };
        YIELDS.push(Y);
        const gen = FN && FN.gen;
        const sw = { s: 'switch', e: { k: 'id', name: '$swsel', line: n.line }, cases: n.cases, arrow: n.arrow, line: n.line, isExpr: true };
        push();
        SC.v.set('$swsel', { type: st, js: sv, name: '$swsel', final: true, fn: FN });
        const saveL = LOOPS; LOOPS = [];
        const body = switchStmt(sw);
        LOOPS = saveL;
        pop();
        YIELDS.pop();
        if (!t) { const ts = Y.types.filter(Boolean); t = ts.length ? ts[0] : null; }
        const fnc = gen ? '(yield* (function* () { ' + body + ' return $.swf(' + sv + '); }).call(this))' : '(() => { ' + body + ' return $.swf(' + sv + '); })()';
        return { c: '(' + sv + ' = ' + R.c + ', ' + fnc + ')', t };
      }
      // ── try / catch / finally, try (ресурсы) ──
      function tryCode(s){
        let body;
        if (s.res && s.res.length) {   // try (Res a = …; Res b = …) { … } — ресурсы видны в теле, закрываются в обратном порядке
          push();
          const parts = [];
          for (const r of s.res) {
            let decl, nm;
            if (r.ty) { const t = r.ty === 'var' ? null : canon(r.ty, FN && FN.cls, r.line); const R = val(r.init, t); const v = declare(r.name, t || R.t, r.line, { final: true }); nm = v.js; decl = 'const ' + nm + ' = ' + conv(R, t, r.line, 'asg') + ';'; }
            else { nm = '$r' + (++TMP); decl = 'const ' + nm + ' = ' + val(r.e).c + ';'; }
            parts.push([decl, nm]);
          }
          let inner = blockCode(s.body);
          for (let i = parts.length - 1; i >= 0; i--) {
            const pv = '$p' + (++TMP);
            inner = '{' + parts[i][0] + ' let ' + pv + ' = null; try ' + inner + ' catch ($x) { ' + pv + ' = $x; throw $x; } finally { $.close(' + parts[i][1] + ', ' + pv + '); }}';
          }
          pop();
          if (!s.catches.length && !s.fin) return inner;
          body = '{' + inner + '}';
        } else body = blockCode(s.body);
        let c = 'try ' + body;
        if (s.catches.length) {
          const ev = '$e' + (++TMP);
          let inner = '', all = false;
          for (const k of s.catches) {
            push();
            const types = k.types.map(t => canon(t, FN && FN.cls, k.line));
            for (const t of types) if (!isThrowT(t)) throw JErr('catch — только для исключений, а ' + shortT(t) + ' не исключение', k.line);
            const v = declare(k.name, types.length === 1 ? types[0] : 'Exception', k.line, {});
            const cond = types.map(t => '$.isExc(' + ev + ', ' + excRef(t) + ')').join(' || ');
            const b = blockCode(k.body);
            pop();
            inner += mark(k.line) + 'if (' + cond + ') { const ' + v.js + ' = ' + ev + '; ' + b + ' } else ';
          }
          if (!all) inner += 'throw ' + ev + ';';
          c += ' catch (' + ev + ') { ' + ev + ' = $.exc(' + ev + '); ' + inner + ' }';
        }
        if (s.fin) c += ' finally ' + blockCode(s.fin);
        return c;
      }
      const excRef = t => { const u = userC(t); if (u) return ownerJs(u); return '$A.' + jsLib(genName(t)); };
      // локальный класс (внутри метода): const Имя = class … { … };
      function localType(d){
        if (d.kind === 'anno') return ';';
        const c = collect(d, FN ? FN.cls : null, { local: true });
        declType(d.name, c);
        headers(c);
        c.declCls = FN ? FN.cls : null;
        if (!FN || !FN.isStatic) c.capSelf = FN && d.kind === 'class' ? capture(FN) : null;
        members(c); nameMethods(c);
        const code = classCode(c, false);
        return 'const ' + c.js + ' = ' + code + ';' + afterClass(c, true);
      }
      // ── классы: JS-класс, конструкторы ($sK — аргументы super, $cK — тело), поля, методы, «распределители» перегрузок ──
      const SCRIPT_MSGS = { awake: 'Awake', onenable: 'OnEnable', start: 'Start', update: 'Update', lateupdate: 'LateUpdate', fixedupdate: 'FixedUpdate', ondisable: 'OnDisable',
        ondestroy: 'OnDestroy', ontouched: 'OnTouched', ontouchended: 'OnTouchEnded', ontriggerenter: 'OnTriggerEnter', ontriggerexit: 'OnTriggerExit', oncollisionenter: 'OnCollisionEnter',
        oncollisionexit: 'OnCollisionExit', onclicked: 'OnClicked', onmousedown: 'OnMouseDown', onplayeradded: 'OnPlayerAdded', onplayerremoving: 'OnPlayerRemoving' };
      function extendsOf(c){
        if (c.baseC) return ' extends ' + ownerJs(c.baseC);
        if (c.iface) return ' extends $A.Object';
        if (c.kind === 'enum') return ' extends $A.Enum';
        if (c.kind === 'record') return ' extends $A.Record';
        if (c.script) return ' extends $.Script';
        if (c.libBase && c.libBase !== 'Object') return ' extends $A.' + jsLib(c.libBase);
        return ' extends $A.Object';
      }
      const fiName = c => '$fi$' + c.js.replace(/[^\w$]/g, '_');
      function classCode(c, isExpr){
        members(c); nameMethods(c);
        const save = [FN, PEND, LOOPS, STL, CUR, LABEL];
        CUR = c; LABEL = null;
        let out = 'class ' + (isExpr && c.anon ? '' : c.js) + extendsOf(c) + ' {';
        if (!c.iface && !c.implicit) out += ctorCode(c) + finitCode(c);
        for (const m of c.mth.values()) { for (const ov of m.ovs) out += methodCode(c, ov); if (m.disp) out += dispCode(c, m, false); }
        for (const m of c.smth.values()) { for (const ov of m.ovs) out += methodCode(c, ov); if (m.disp) out += dispCode(c, m, true); }
        out += 'static $q = ' + JSON.stringify(c.anon ? '' : c.q) + ';';
        if (U.pkg && !c.anon && !c.local) out += 'static $pkg = ' + JSON.stringify(U.pkg) + ';';
        if (c.kind === 'record') out += 'static $comps = ' + JSON.stringify(c.comps.map(x => [x.name, kindOf(c.fld.get(x.name).type)])) + ';';
        if (c.iface) out += 'static $isI = true;';
        const subs = [];
        for (const m of c.mth.values()) for (const ov of m.ovs) { const a = ov.annos.find(x => x.name === 'SubscribeEvent'); if (a && ov.params.length === 1) subs.push([ov.js, genName(ov.params[0].ty)]); }
        if (subs.length) out += 'static $subs = ' + JSON.stringify(subs) + ';';
        out += '}';
        [FN, PEND, LOOPS, STL, CUR, LABEL] = save;
        return out;
      }
      // код после объявления класса: значения полей по умолчанию, интерфейсы
      function afterClass(c, local){
        const P = [], S = [];
        for (const f of c.fld.values()) { if (f.econst) continue; const dv = defaultInit(f.type).replace(/^ = /, '') || 'null'; (f.static ? S : P).push(fkey(f.name) + ': ' + (f.type === 'var' ? 'null' : dv)); }
        let out = '';
        if (P.length) out += '$.pd(' + c.js + '.prototype, {' + P.join(', ') + '});';
        if (S.length) out += '$.pd(' + c.js + ', {' + S.join(', ') + '});';
        const ui = c.ifaces.map(t => userC(t)).filter(Boolean), li = [];
        for (const t of c.ifaces) if (!userC(t)) li.push(genName(t));
        if (ui.length || li.length) out += '$.impl(' + c.js + ', [' + ui.map(ownerJs).join(', ') + '], ' + JSON.stringify(li) + ');';
        if (local) out += clinitBody(c);
        return out;
      }
      function ctorCode(c){
        if (c.anon) return 'constructor(...$a) { super(...$a); this.' + fiName(c) + '(); }';
        const ks = c.ctors, enumC = c.kind === 'enum', cjs = c.js.replace(/[^\w$]/g, '_');
        let out = '';
        const hasBase = !!c.baseC;
        ks.forEach((k, i) => {
          const fd = k.fn;
          const body = fd && fd.body ? fd.body.body : [];
          const first = body[0] && body[0].s === 'ctorcall' ? body[0] : null;
          if (first && enumC && first.kind === 'super') throw JErr('В конструкторе enum нельзя вызывать super(…)', first.line);
          if (body.slice(1).some(s => s.s === 'ctorcall')) throw JErr('this(…) / super(…) — только первой строкой конструктора', body.find((s, j) => j && s.s === 'ctorcall').line);
          // аргументы super: static $sK(…)
          {
            const save = [FN, SC, PEND];
            FN = newFn({ kind: 'superargs', cls: c, isStatic: true, self: null, ret: null, node: { sa: k } });
            push(); PEND = [];
            const ps = k.params.map(p => declare(p.name, p.ty, p.line || c.d.line, { param: true }).js);
            let ret;
            if (first && first.kind === 'this') {
              const cands = ks.map((kk, j) => ({ ps: kk.params.map(p => p.ty), va: kk.va, ret: null, mtps: [], j }));
              const r = choose(cands, first.args, first.line, 'this', null);
              if (r.k.j === i) throw JErr('Конструктор вызывает сам себя (this(…))', first.line);
              k.thisTo = r.k.j; k.thisArgs = r.codes;
              ret = ownerJs(c) + '.$s' + r.k.j + '(' + r.codes.join(', ') + ')';
            } else if (hasBase) {
              const bc = c.baseC; members(bc); nameMethods(bc);
              const map = {}; bc.tps.forEach((x, j) => map[x] = c.base ? genArgs(c.base)[j] || null : null);
              const cands = bc.ctors.map((kk, j) => ({ ps: kk.params.map(p => subst(p.ty, map)), va: kk.va, ret: null, mtps: [], j }));
              if (!cands.length) cands.push({ ps: [], va: false, ret: null, mtps: [], j: 0 });
              let r;
              try { r = choose(cands, first ? first.args : [], first ? first.line : k.line, 'super', null); }
              catch (e) { if (!first) throw JErr('У базового класса ' + bc.name + ' нет конструктора без параметров: вызови super(…) с аргументами первой строкой конструктора', k.line); throw e; }
              const outerArg = bc.inner ? (c.inner && c.outer === bc.outer ? '$o' : instExpr(bc.outer, k.line)) + ', ' : '';
              ret = '[' + outerArg + (r.ambiguous ? -1 : r.k.j) + (r.codes.length ? ', ' + r.codes.join(', ') : '') + ']';
            } else if (enumC) ret = '[]';
            else if (c.libBase && c.libBase !== 'Object' && first) {
              const sigs = (libE(c.libBaseT || c.libBase).ctor || []).map(sg => ({ ps: sg.ps, va: sg.va, ret: null, mtps: [] }));
              const r = choose(sigs.length ? sigs : [{ ps: [], va: false, mtps: [] }], first.args, first.line, 'super', null);
              ret = '[' + r.codes.join(', ') + ']';
            } else { if (first && first.args.length) throw JErr('super(…) с аргументами — у класса нет базового конструктора с параметрами', first.line); ret = '[]'; }
            const dl = PEND.length ? 'let ' + [...new Set(PEND)].join(', ') + '; ' : '';
            pop(); [FN, SC, PEND] = save;
            out += 'static $s' + i + '(' + ps.join(', ') + ') { ' + dl + 'return ' + ret + '; }';
          }
          // тело: $cK(…)
          {
            const save = [FN, SC, PEND, LOOPS, STL];
            FN = newFn({ kind: 'ctor', cls: c, isStatic: false, self: 'this', ret: 'void', node: fd || { dflt: k }, name: c.name });
            FN.root = FN; LOOPS = [];
            push();
            const ps = k.params.map(p => declare(p.name, p.ty, p.line || c.d.line, { param: true }).js);
            let code = '';
            if (k.thisTo !== undefined) code += mark(first.line) + 'this.$c' + k.thisTo + '$' + cjs + '(' + k.thisArgs.join(', ') + ');';
            if (c.kind === 'record' && k.canonical && (!fd || !fd.body)) {
              if (c.cctor) { push(); code += c.cctor.body.body.map(s => stmtCode(s)).join(''); pop(); }
              for (const cp of c.comps) code += 'this[' + fkey(cp.name) + '] = ' + jsName(cp.name) + ';';
            }
            if (fd && fd.body) { push(); code += (first ? body.slice(1) : body).map(s => stmtCode(s)).join(''); pop(); }
            const pro = FN.capSelf ? 'const ' + FN.capSelf + ' = this; ' : '';
            pop();
            [FN, SC, PEND, LOOPS, STL] = save;
            out += (fd ? mark(fd.line) : '') + '$c' + i + '$' + cjs + '(' + ps.join(', ') + ') {' + pro + code + (fd && fd.body ? mark(fd.body.end) : '') + '}';
          }
        });
        const csig = '[' + ks.map(k => sigCode({ params: k.params, va: k.va })).join(', ') + ']';
        out += 'static $csig() { return ' + csig + '; }';
        const hid = (c.inner ? '$o, ' : '') + '$k' + (enumC ? ', $n, $i' : '');
        const sup = enumC ? 'super($n, $i);' : 'super(...' + ownerJs(c) + '["$s" + $k](...$a));';
        out += 'constructor(' + hid + ', ...$a) { if ($k < 0) $k = $.ovk($a, ' + ownerJs(c) + '.$csig(), ' + JSON.stringify(c.name) + '); ' + sup + (c.inner ? ' this.$o = $o;' : '') +
          ' this.' + fiName(c) + '(); this["$c" + $k + "$' + cjs + '"](...$a); }';
        return out;
      }
      // поля объекта со значениями и блоки { … } — по порядку в коде
      function finitCode(c){
        const save = [FN, SC, PEND, LOOPS, STL];
        FN = newFn({ kind: 'finit', cls: c, isStatic: false, self: 'this', ret: null, node: { fi: c }, initOf: c });
        FN.root = FN; LOOPS = [];
        push();
        let out = '';
        for (const m of c.d.members) {
          if (m.m === 'field' && !m.mods.has('static') && !c.iface) for (const x of m.decls) {
            if (!x.init) continue;
            const f = c.fld.get(x.name);
            PEND = []; STL = x.line;
            const code = x.init.k === 'arrinit' ? arrLit(x.init, f.type).c : conv(val(x.init, f.type), f.type, x.line, 'asg');
            out += mark(x.line) + (PEND.length ? 'let ' + [...new Set(PEND)].join(', ') + '; ' : '') + 'this[' + fkey(x.name) + '] = ' + code + ';';
          }
          if (m.m === 'init' && !m.st) out += stmtCode(m.body);
        }
        const pro = FN.capSelf ? 'const ' + FN.capSelf + ' = this; ' : '';
        pop();
        [FN, SC, PEND, LOOPS, STL] = save;
        return fiName(c) + '() {' + pro + out + '}';
      }
      function methodCode(c, ov){
        if (ov.acc) return ov.js + '() { return this[' + fkey(ov.acc) + ']; }';
        const fd = ov.fn;
        if (!fd || !fd.body) return '';
        const gen = PASS === 2 && GENS.has(fd);
        const save = [FN, SC, PEND, LOOPS, STL, YIELDS];
        FN = newFn({ kind: 'method', cls: c, isStatic: ov.static, self: ov.static ? null : 'this', ret: ov.ret, tps: c.tps.concat(ov.tps), gen, node: fd, ovFam: famOf(ov),
          syncOnly: SYNC_ONLY.has(ov.name) && !ov.static, name: ov.name });
        FN.root = FN; LOOPS = []; YIELDS = [];
        if (gen && FN.syncOnly) throw JErr('Метод ' + ov.name + '() вызывает сама Java (печать, сравнение, коллекции) — ждать (wait / sleep) в нём нельзя', fd.line);
        push();
        const ps = ov.params.map(p => declare(p.name, p.ty, p.line || fd.line, { param: true }).js);
        const body = fnBody(fd.body);
        if (ov.ret && ov.ret !== 'void' && canComplete(fd.body.body)) throw JErr('Метод ' + ov.name + ' должен вернуть ' + shortT(ov.ret) + ', а в конце нет return', fd.end || fd.line);
        pop();
        [FN, SC, PEND, LOOPS, STL, YIELDS] = save;
        return mark(fd.line) + (ov.static ? 'static ' : '') + (gen ? '*' : '') + ov.js + '(' + ps.join(', ') + ') ' + body;
      }
      const tagOf = t => {
        const p = prim(t);
        if (p === 'int' || p === 'short' || p === 'byte') return '"I"'; if (p === 'long') return '"J"'; if (p === 'double' || p === 'float') return '"D"';
        if (p === 'char') return '"C"'; if (p === 'boolean') return '"Z"'; if (t === 'String') return '"S"';
        const u = userC(t); if (u && !u.iface) return ownerJs(u);
        if (isArrT(t)) return JSON.stringify('[' + arrTag(arrElem(t)));
        const g = genName(t); if (['List', 'Map', 'Set', 'Collection'].includes(g)) return JSON.stringify(g);
        return '"*"';
      };
      const sigCode = ov => { const ps = ov.params, va = ov.va; return '[' + (va ? ps.length - 1 : ps.length) + ', ' + (va ? 99 : ps.length) + ', [' + ps.map(p => tagOf(p.ty)).join(', ') + ']]'; };
      function dispCode(c, m, st){
        const all = st ? m.ovs : m.disp;
        let body = 'switch ($.ovs($a, [' + all.map(sigCode).join(', ') + '], ' + JSON.stringify(m.name) + ')) {';
        all.forEach((ov, i) => {
          let call;
          if (st || m.ovs.includes(ov) || (ov.js !== mjs(m.name) && !ov.obj && !ov.lib)) call = 'this[' + JSON.stringify(ov.js) + '](...$a)';
          else if (ov.via && ov.via.js) call = ownerJs(ov.via) + '.prototype.' + ov.js + '.call(this, ...$a)';
          else call = 'super.' + ov.js + '(...$a)';
          body += 'case ' + i + ': return ' + call + ';';
        });
        return (st ? 'static ' : '') + mjs(m.name) + '(...$a) {' + body + '}}';
      }
      // может ли код «дойти до конца» (для «нет return в конце метода»)
      const isTrue = e => e && e.k === 'bool' && e.v === true;
      function canComplete(list){ for (const s of list) if (!completes(s)) return false; return true; }
      function hasBreak(s, label){
        let y = false;
        const walk = (x, depth) => {
          if (!x || y) return;
          if (Array.isArray(x)) { x.forEach(z => walk(z, depth)); return; }
          switch (x.s) {
            case 'break': if (x.label ? x.label === label : depth === 0) y = true; return;
            case 'block': walk(x.body, depth); return;
            case 'if': walk(x.a, depth); walk(x.b, depth); return;
            case 'while': case 'do': case 'for': case 'foreach': walk(x.body, depth + 1); return;
            case 'label': walk(x.body, depth); return;
            case 'switch': x.cases.forEach(cs => cs.body.kind === 'stmts' ? walk(cs.body.list, depth + 1) : cs.body.kind === 'block' ? walk(cs.body.b, depth + 1) : 0); return;
            case 'try': walk(x.body, depth); x.catches.forEach(k => walk(k.body, depth)); walk(x.fin, depth); return;
          }
        };
        walk(s, 0);
        return y;
      }
      function completes(s){
        switch (s.s) {
          case 'return': case 'throw': return false;
          case 'block': return canComplete(s.body);
          case 'if': return !s.b || completes(s.a) || completes(s.b);
          case 'while': return !isTrue(s.c) || hasBreak(s.body);
          case 'do': return (completes(s.body) && !isTrue(s.c)) || hasBreak(s.body);
          case 'for': return (!!s.c && !isTrue(s.c)) || hasBreak(s.body);
          case 'label': return completes(s.body) || hasBreak(s.body, s.label);
          case 'switch': {
            if (!s.cases.some(c => c.labels.some(l => l.p === 'default'))) return true;
            if (s.arrow) return s.cases.some(c => c.body.kind === 'expr' || (c.body.kind === 'block' && (canComplete(c.body.b.body) || hasBreak(c.body.b))));
            const last = s.cases[s.cases.length - 1];
            return canComplete(last.body.list) || s.cases.some(c => hasBreak(c.body.list));
          }
          case 'try': { const tc = completes(s.body) || s.catches.some(k => completes(k.body)); return s.fin ? tc && completes(s.fin) : tc; }
          case 'expr': return !(s.e.k === 'call' && s.e.f.k === 'mem' && s.e.f.name === 'exit' && s.e.f.o.k === 'id' && s.e.f.o.name === 'System' && false);
        }
        return true;
      }
      // static: поля и блоки static { … } по порядку; enum — сначала константы
      function clinitBody(c){
        members(c); nameMethods(c);
        const save = [FN, SC, PEND, LOOPS, STL];
        FN = newFn({ kind: 'clinit', cls: c, isStatic: true, self: null, ret: null, node: { ci: c }, initOf: c });
        FN.root = FN; LOOPS = [];
        push();
        let out = '';
        const deps = new Set(); USEDCLS = deps;
        if (c.kind === 'enum') {
          const vals = [];
          c.consts.forEach((k, i) => {
            PEND = []; STL = k.line;
            const cands = c.ctors.map((kk, j) => ({ ps: kk.params.map(p => p.ty), va: kk.va, ret: null, mtps: [], j }));
            const r = choose(cands, k.args || [], k.line, c.name + '(' + k.name + ')', null);
            let cls = c.js;
            if (k.body) {
              const d = { kind: 'class', name: '', members: k.body.members, mods: new Set(), line: k.line, end: k.body.end, impl: [], tps: null, annos: [] };
              const ac = collect(d, c, { anon: true });
              ac.base = c.q; ac.baseC = c; ac.declCls = c; ac.capSelf = null; ac.ctors = [];
              members(ac); nameMethods(ac);
              cls = '(' + classCode(ac, true) + ')';
            }
            const dl = PEND.length ? 'let ' + [...new Set(PEND)].join(', ') + '; ' : '';
            out += mark(k.line) + dl + c.js + '[' + fkey(k.name) + '] = new ' + cls + '(' + (r.ambiguous ? -1 : r.k.j) + ', ' + JSON.stringify(k.name) + ', ' + i + (r.codes.length ? ', ' + r.codes.join(', ') : '') + ');';
            vals.push(c.js + '[' + fkey(k.name) + ']');
          });
          out += c.js + '.$values = [' + vals.join(', ') + '];';
        }
        for (const m of c.d.members) {
          if (m.m === 'field' && (m.mods.has('static') || c.iface) && !c.implicit) for (const x of m.decls) {
            if (!x.init) continue;
            const f = c.fld.get(x.name);
            PEND = []; STL = x.line;
            const code = x.init.k === 'arrinit' ? arrLit(x.init, f.type).c : conv(val(x.init, f.type), f.type, x.line, 'asg');
            out += mark(x.line) + (PEND.length ? 'let ' + [...new Set(PEND)].join(', ') + '; ' : '') + c.js + '[' + fkey(x.name) + '] = ' + code + ';';
          }
          if (m.m === 'init' && m.st) out += stmtCode(m.body);
        }
        USEDCLS = null;
        pop();
        [FN, SC, PEND, LOOPS, STL] = save;
        c.clinitDeps = deps;
        return out ? '{' + out + '}' : '';
      }
      // ── вход: код верхнего уровня ($main), main(String[] args), классы Script, моды (ModInitializer, @Mod) ──
      function mainCode(){
        const items = U.items.filter(x => x.m !== 'method');
        if (!items.length) return null;
        const save = [FN, SC, PEND, LOOPS, STL];
        FN = newFn({ kind: 'main', cls: MAIN, isStatic: true, self: null, ret: null, node: U, gen: PASS === 2 && GENS.has(U) });
        FN.root = FN; LOOPS = [];
        push();
        let out = '';
        for (const it of items) {
          if (it.m === 'field') {
            for (const x of it.decls) {
              const f = MAIN.fld.get(x.name);
              PEND = []; STL = x.line;
              let code;
              if (!x.init) code = (defaultInit(f.type).replace(/^ = /, '') || 'null');
              else if (x.init.k === 'arrinit') { if (f.type === 'var') throw JErr('var x = { … } нельзя — напиши тип: int[] x = { … }', x.line); code = arrLit(x.init, f.type).c; }
              else {
                const R = val(x.init, f.type === 'var' ? null : f.type);
                if (f.type === 'var') { if (R.isNull) throw JErr('var x = null — так нельзя: напиши тип', x.line); f.type = R.t; }
                code = conv(R, f.type, x.line, 'asg');
              }
              out += mark(x.line) + (PEND.length ? 'let ' + [...new Set(PEND)].join(', ') + '; ' : '') + '$Main[' + fkey(x.name) + '] = ' + code + ';';
            }
            continue;
          }
          out += stmtCode(it);
        }
        pop();
        const F = FN;
        [FN, SC, PEND, LOOPS, STL] = save;
        return { code: out, gen: F.gen, line: items[0].line };
      }
      // ── порядок: базовые классы раньше наследников; static-инициализация — по зависимостям ──
      function allClasses(){
        const out = [], seen = new Set();
        const visit = c => { if (seen.has(c) || c.ext) return; seen.add(c); if (c.baseC) visit(c.baseC); out.push(c); for (const n of c.nested.values()) visit(n); };
        for (const c of CL.values()) visit(c);
        return out;
      }
      function emitAll(){
        TMP = 0; FID = 0; MRN = 0; USED.clear(); LABEL = null; YIELDS = []; SC = null; FN = null; PEND = null; LOOPS = []; ANON.n = 0;
        if (PASS === 1) { FNS = []; TOPSUSP = { direct: false, edges: new Set() }; }
        push();
        const M = mainCode();
        const classes = allClasses();
        let defs = '', after = '', inits = [];
        for (const c of classes) { if (c.kind === 'anno') continue; defs += mark(c.d.line) + classCode(c, false) + mark(c.d.end); }
        MAIN.membersDone || members(MAIN);
        nameMethods(MAIN);
        const mainCls = MAIN.mth.size || MAIN.smth.size || MAIN.fld.size ? classCode(MAIN, false) : '';
        for (const c of classes) after += afterClass(c, false);
        if (mainCls) after += afterClass(MAIN, false);
        for (const c of classes) { const b = clinitBody(c); if (b) inits.push({ c, b }); }
        // static-инициализация: сначала те, на кого ссылаются
        const order = [], done = new Set(), busy = new Set();
        const visit = x => { if (done.has(x) || busy.has(x)) return; busy.add(x); for (const d of x.c.clinitDeps || []) { const y = inits.find(z => z.c === d); if (y && y !== x) visit(y); } busy.delete(x); done.add(x); order.push(x); };
        for (const x of inits) visit(x);
        pop();
        let code = defs + (mainCls ? mark(MAIN.d.line) + mainCls : '') + after + order.map(x => x.b).join('');
        let main = 'null';
        if (M) { code += mark(M.line) + 'function' + (M.gen ? '*' : '') + ' $main() {' + M.code + mainTail() + '}'; main = '$main'; }
        else {
          const mm = MAIN.smth && MAIN.smth.get('main');
          if (mm) main = '() => $Main.' + mm.ovs[0].js + '(' + (mm.ovs[0].params.length ? '[]' : '') + ')';
          else {
            const pc = classes.find(c => { const m = c.smth && c.smth.get('main'); return m && m.ovs.some(o => o.params.length <= 1); });
            if (pc) { const o = pc.smth.get('main').ovs.find(x => x.params.length <= 1); main = '() => ' + pc.js + '.' + o.js + '(' + (o.params.length ? '[]' : '') + ')'; }
          }
        }
        const isScript = c => { for (let x = c, k = 0; x && k < 50; x = x.baseC, k++) if (x.script) return true; return false; };
        const scripts = classes.filter(c => isScript(c) && !c.abstract && !c.tps.length && !c.inner).map(c => '[' + c.js + ', ' + JSON.stringify(c.name) + ', ' + JSON.stringify(msgMeta(c)) + ']');
        const mods = [];
        for (const c of classes) {
          if (c.abstract || c.inner) continue;
          const ifs = supers(c.q).map(genName);
          if (ifs.includes('ModInitializer')) mods.push('[' + c.js + ', "fabric", ' + JSON.stringify(c.q) + ']');
          else if (ifs.includes('ClientModInitializer') || ifs.includes('DedicatedServerModInitializer')) mods.push('[' + c.js + ', "client", ' + JSON.stringify(c.q) + ']');
          if ((c.d.annos || []).some(a => a.name === 'Mod')) mods.push('[' + c.js + ', "forge", ' + JSON.stringify(c.q) + ']');
          if ((c.d.annos || []).some(a => a.name === 'EventBusSubscriber' || a.full === 'Mod.EventBusSubscriber')) mods.push('[' + c.js + ', "subscriber", ' + JSON.stringify(c.q) + ']');
        }
        const exp = classes.filter(c => !c.local && !c.anon).map(c => JSON.stringify(c.q) + ': ' + c.js);
        code += 'return { main: ' + main + ', scripts: [' + scripts.join(', ') + '], mods: [' + mods.join(', ') + '], classes: {' + exp.join(', ') + '} };';
        return code;
      }
      function mainTail(){   // void main() у «компактного» файла (Java 25) — после кода верхнего уровня
        const mm = MAIN.smth && MAIN.smth.get('main');
        if (!mm) return '';
        const ov = mm.ovs.find(o => o.params.length === 0) || mm.ovs.find(o => o.params.length === 1 && o.params[0].ty === 'String[]');
        if (!ov) return '';
        const call = '$Main.' + ov.js + '(' + (ov.params.length ? '[]' : '') + ')';
        return mark(ov.line) + (PASS === 2 && FAMS.has(famOf(ov)) ? 'yield* ' + call : call) + ';';
      }
      function msgMeta(c){
        const meta = {};
        const seen = new Set();
        for (let x = c, k = 0; x && k < 50; x = x.baseC, k++) {
          members(x); nameMethods(x);
          for (const m of x.mth.values()) { const key = SCRIPT_MSGS[m.name.toLowerCase()]; if (!key || seen.has(key)) continue; seen.add(key); const ov = m.ovs[0]; meta[key] = [ov.params.length, ov.params[0] ? genName(ov.params[0].ty) : null, ov.js]; }
        }
        return meta;
      }
      // ── сборка: два прохода (первый узнаёт, какие функции ждут — wait / sleep — и становятся генераторами) ──
      return function run(lastLine){
        for (const c of CL.values()) if (!c.outer) headers(c);
        for (const c of CL.values()) { const seen = new Set(); for (let b = c; b; b = b.baseC) { if (seen.has(b)) throw JErr('Класс ' + c.name + ' наследует сам себя', c.d.line); seen.add(b); } }
        for (const c of CL.values()) { members(c); nameMethods(c); }
        members(MAIN); nameMethods(MAIN);
        PASS = 1;
        emitAll();
        // неподвижная точка: функция ждёт, если ждёт сама или вызывает «ждущее» семейство методов
        GENS = new Set(); FAMS = new Set();
        let changed = true;
        while (changed) {
          changed = false;
          for (const F of FNS) {
            if (!F.node || GENS.has(F.node)) continue;
            if (F.direct || [...F.edges].some(f => FAMS.has(f)) || (F.userFam && FAMS.has(F.userFam)) || (F.ovFam && FAMS.has(F.ovFam))) { GENS.add(F.node); changed = true; }
          }
          for (const F of FNS) {
            if (!F.node || !GENS.has(F.node)) continue;
            if (F.ovFam && !FAMS.has(F.ovFam)) { FAMS.add(F.ovFam); changed = true; }
            if (F.userFam && !FAMS.has(F.userFam)) { FAMS.add(F.userFam); changed = true; }
          }
          if (!GENS.has(U) && (TOPSUSP.direct || [...TOPSUSP.edges].some(f => FAMS.has(f)))) { GENS.add(U); changed = true; }
        }
        for (const F of FNS) if (F.kind === 'main' && (F.direct || [...F.edges].some(f => FAMS.has(f)))) GENS.add(U);
        PASS = 2;
        const code = emitAll();
        return Object.assign(assemble(code, "'use strict'; const $A = $.A, $G = $.G, $S = $.S, $F = $.F, BigInt = $.JS.BigInt, Math = $.JS.Math, Number = $.JS.Number, String = $.JS.String; "), { types: CL });
      };
    }

    function assemble(code, pro){   // метки строк → переводы строк; карта: строка JS → [[столбец, строка Java], …]
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
    function compile(src, xc, mode){
      const T = lex(String(src));
      const U = parse(T).unit();
      return gen(U, xc, { mode: mode || 'studio' })(T[T.length - 1].line);
    }
    // ═══ 6. Библиотека Java внутри песочницы ═══
    // ── числа в строки как в Java: Double.toString / Float.toString (кратчайшие цифры), String.format ──
    function decDigits(v, isF){   // кратчайшие цифры |v|: { d: '12345', e: 2 } → 1.2345e2
      const a = Math.abs(v);
      let s = null;
      if (isF) { const f = Math.fround(a); for (let p = 1; p <= 9; p++) { const t = f.toPrecision(p); if (Math.fround(+t) === f) { s = (+t).toExponential(); break; } } }
      if (!s) s = a.toExponential();
      const k = s.indexOf('e');
      return { d: s.slice(0, k).replace('.', ''), e: +s.slice(k + 1) };
    }
    function sciStr(v, isF){
      if (v !== v) return 'NaN';
      if (v === Infinity) return 'Infinity'; if (v === -Infinity) return '-Infinity';
      if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
      const a = Math.abs(v), sg = v < 0 ? '-' : '';
      const { d, e } = decDigits(v, isF);
      if (a >= 1e-3 && a < 1e7) {
        if (e >= 0) { const ip = d.slice(0, e + 1).padEnd(e + 1, '0'), fp = d.slice(e + 1); return sg + ip + '.' + (fp || '0'); }
        return sg + '0.' + '0'.repeat(-e - 1) + d;
      }
      return sg + d[0] + '.' + (d.slice(1) || '0') + 'E' + e;
    }
    const dstr = v => sciStr(v, false), fstr = v => sciStr(v, true);
    function roundDigits(digits, need){   // оставить need цифр, половина — вверх (HALF_UP, как Formatter в Java)
      let carry = 0;
      if (digits.length > need) {
        const up = digits.charCodeAt(need) >= 53;
        digits = digits.slice(0, need);
        if (up) {
          const arr = digits.split(''); let i = arr.length - 1;
          while (i >= 0) { if (arr[i] === '9') { arr[i] = '0'; i--; } else { arr[i] = CH(arr[i].charCodeAt(0) + 1); break; } }
          if (i < 0) { arr.unshift('1'); carry = 1; }
          digits = arr.join('');
        }
      } else digits = digits.padEnd(need, '0');
      return { digits, carry };
    }
    function fixedJ(v, prec, isF){
      if (!isFinite(v)) return v !== v ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
      const neg = v < 0 || Object.is(v, -0);
      if (v === 0) return (neg ? '-' : '') + '0' + (prec > 0 ? '.' + '0'.repeat(prec) : '');
      let { d, e } = decDigits(v, isF);
      let point = e + 1;
      if (point <= 0) { d = '0'.repeat(1 - point) + d; point = 1; }
      const r = roundDigits(d, point + prec);
      point += r.carry;
      let ip = r.digits.slice(0, point).replace(/^0+(?=\d)/, ''), fp = r.digits.slice(point);
      return (neg ? '-' : '') + ip + (prec > 0 ? '.' + fp : '');
    }
    function expJ(v, prec, isF){
      if (!isFinite(v)) return v !== v ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
      const neg = v < 0 || Object.is(v, -0);
      if (v === 0) return (neg ? '-' : '') + '0' + (prec > 0 ? '.' + '0'.repeat(prec) : '') + 'e+00';
      let { d, e } = decDigits(v, isF);
      const r = roundDigits(d, 1 + prec);
      let digits = r.digits; if (r.carry) { e++; digits = digits.slice(0, 1 + prec); }
      return (neg ? '-' : '') + digits[0] + (prec > 0 ? '.' + digits.slice(1) : '') + 'e' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
    }
    const groupStr = s => { const m = /^(-?)(\d+)(.*)$/.exec(s); return m ? m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + m[3] : s; };

    let RT = null;   // общее для всех Java-скриптов песочницы
    function boot(env, ctx0){
      if (RT && RT.env === env) return RT;
      if (RT && RT.mode === 'studio' && env.Vector3 && RT.V3B === env.Vector3) return RT;
      const MODE = env && env.script && env.script.mod && env.script.world && !env.workspace ? 'mod' : 'studio';
      const V3B = env.Vector3 || class { constructor(x = 0, y = 0, z = 0){ this.X = +x || 0; this.Y = +y || 0; this.Z = +z || 0; } };
      const isV = v => v instanceof V3B;
      // ── хеши «как у объекта» (identityHashCode) ──
      const IH = new WeakMap();
      let ihs = 0x1b6d3586;
      const ih = o => { if (o === null || (typeof o !== 'object' && typeof o !== 'function')) return 0; let h = IH.get(o); if (h === undefined) { ihs = (Math.imul(ihs ^ (ihs >>> 15), 0x2c1b3c6d) + 0x297a2d39) | 0; h = (ihs >>> 1) | 0x01000000; IH.set(o, h); } return h; };
      const hex = n => (n >>> 0).toString(16);
      // ── исключения Java ──
      class Throwable extends Error {
        constructor(msg, cause){
          let m = msg, c = cause;
          if (msg instanceof Throwable && cause === undefined) { c = msg; m = msg.toString(); }
          super(m == null ? '' : String(m));
          this.$msg = m == null ? null : String(m); this.$cause = c || null; this.$sup = [];
        }
        getMessage(){ return this.$msg; }
        getLocalizedMessage(){ return this.getMessage(); }
        getCause(){ return this.$cause; }
        initCause(c){ this.$cause = c; return this; }
        addSuppressed(e){ this.$sup.push(e); }
        getSuppressed(){ return this.$sup.slice(); }
        getStackTrace(){ return []; }
        printStackTrace(){ RT.errOut(this.toString()); if (this.$cause) RT.errOut('Caused by: ' + this.$cause.toString()); }
        toString(){ const n = fqName(this.constructor), m = this.getLocalizedMessage(); return m != null ? n + ': ' + m : n; }
        equals(o){ return this === o; }
        hashCode(){ return ih(this); }
        getClass(){ return clsObj(this.constructor); }
      }
      Throwable.prototype.$jv = true;
      const EX = { Throwable };
      const PKGOF = { NoSuchElementException: 'java.util', ConcurrentModificationException: 'java.util', InputMismatchException: 'java.util', EmptyStackException: 'java.util',
        IOException: 'java.io', UncheckedIOException: 'java.io', TimeoutException: 'java.util.concurrent', DateTimeException: 'java.time' };
      for (const [n, b] of EXC_LIST) if (n !== 'Throwable') { EX[n] = ({ [n]: class extends EX[b] {} })[n]; }
      for (const n of Object.keys(EX)) { EX[n].$q = n; EX[n].$fq = (PKGOF[n] || 'java.lang') + '.' + n; EX[n].$exc = true; }
      const fqName = C => C.$fq && Object.prototype.hasOwnProperty.call(C, '$fq') ? C.$fq : (C.$pkg ? C.$pkg + '.' : '') + (C.$q || C.name || 'Object');
      const npe = what => new EX.NullPointerException(what ? 'обращение к «' + what + '» у null' : null);
      const aioobe = (i, n) => new EX.ArrayIndexOutOfBoundsException('индекс ' + i + ' вне границ массива (длина ' + n + ')');
      const ioobe = (i, n) => new EX.IndexOutOfBoundsException('индекс ' + i + ' вне границ (элементов: ' + n + ')');
      const sioobe = (i, n) => new EX.StringIndexOutOfBoundsException('индекс ' + i + ' вне строки (длина ' + n + ')');
      const uoe = w => new EX.UnsupportedOperationException(w || 'этот список (map, set) нельзя менять: он неизменяемый (List.of, Map.of …)');
      const nse = w => new EX.NoSuchElementException(w || 'элементов больше нет');
      const cme = () => new EX.ConcurrentModificationException('коллекцию изменили во время перебора (for-each): удаляй через iterator.remove() или removeIf(…)');
      // ── базовые классы: Object, Enum, Record ──
      class JObject {
        equals(o){ return this === o; }
        hashCode(){ return ih(this); }
        toString(){ return fqName(this.constructor) + '@' + hex(this.hashCode()); }
        getClass(){ return clsObj(this.constructor); }
      }
      JObject.prototype.$jv = true;
      JObject.$q = 'Object'; JObject.$fq = 'java.lang.Object';
      class JChar extends JObject {   // Character (char в Object, List<Character> …) — чтобы не путать с String из одной буквы
        constructor(c){ super(); this.c = c; }
        charValue(){ return this.c; } toString(){ return this.c; } valueOf(){ return this.c.charCodeAt(0); }
        equals(o){ return o instanceof JChar && o.c === this.c; } hashCode(){ return this.c.charCodeAt(0); }
        compareTo(o){ return this.c.charCodeAt(0) - (o instanceof JChar ? o.c : String(o)).charCodeAt(0); }
      }
      const JCH = new Map();
      const bc = c => { if (c == null || c instanceof JChar) return c; let o = JCH.get(c); if (!o) { o = new JChar(c); if (JCH.size < 4096) JCH.set(c, o); } return o; };
      class JEnum extends JObject {
        constructor(n, i){ super(); Object.defineProperty(this, '$name', { value: n }); Object.defineProperty(this, '$ord', { value: i }); }
        name(){ return this.$name; }
        ordinal(){ return this.$ord; }
        toString(){ return this.$name; }
        compareTo(o){ if (o == null) throw npe('compareTo'); return this.$ord - o.$ord; }
        equals(o){ return this === o; }
        hashCode(){ return ih(this); }
        getDeclaringClass(){ let C = this.constructor; while (C && !Object.prototype.hasOwnProperty.call(C, '$values')) C = Object.getPrototypeOf(C); return clsObj(C || this.constructor); }
      }
      class JRecord extends JObject {
        $cs(){ let C = this.constructor; while (C && !Object.prototype.hasOwnProperty.call(C, '$comps')) C = Object.getPrototypeOf(C); return C ? C.$comps : []; }
        equals(o){ if (o === this) return true; if (o == null || o.constructor !== this.constructor) return false; return this.$cs().every(([n]) => jeq(this['#' + n], o['#' + n])); }
        hashCode(){ let h = 0; for (const [n] of this.$cs()) h = (Math.imul(h, 31) + hcAny(this['#' + n])) | 0; return h; }
        toString(){ return (this.constructor.$q || '').split('.').pop() + '[' + this.$cs().map(([n, k]) => n + '=' + jstr(this['#' + n], k)).join(', ') + ']'; }
      }
      // ── String.valueOf(Object): null → "null", 5 → "5", 2.5 → "2.5", массив → [I@1b6d3586 ──
      const ARRN = new Map([[Int32Array, '[I'], [Float64Array, '[D'], [BigInt64Array, '[J'], [Int16Array, '[S'], [Int8Array, '[B'], [Float32Array, '[F']]);
      const arrName = a => ARRN.get(a.constructor) || (a.$jt === 'C' ? '[C' : a.$jt === 'Z' ? '[Z' : '[Ljava.lang.Object;');
      function jstr(x, k){
        if (x === null || x === undefined) return 'null';
        switch (typeof x) {
          case 'string': return x;
          case 'number': return k === 'D' ? dstr(x) : k === 'F' ? fstr(x) : Number.isInteger(x) && Math.abs(x) < 9007199254740992 && !Object.is(x, -0) ? String(x) : dstr(x);
          case 'bigint': return String(x);
          case 'boolean': return x ? 'true' : 'false';
          case 'function': return 'Main$$Lambda@' + hex(ih(x));
          case 'object':
            if (Array.isArray(x) || ArrayBuffer.isView(x)) return arrName(x) + '@' + hex(ih(x));
            if (isV(x)) return '(' + [x.X, x.Y, x.Z].map(v => fixedJ(v, 2)).join(', ') + ')';
            if (typeof x.toString === 'function' && x.toString !== Object.prototype.toString) { const s = x.toString(); return s == null ? 'null' : String(s); }
            if (typeof x.Name === 'string') return x.Name;
            return 'Object@' + hex(ih(x));
        }
        return String(x);
      }
      // ── равенство и хеш как в Java (equals / hashCode) ──
      function jeq(a, b){
        if (a === b) return true;
        if (a == null || b == null) return false;
        const ta = typeof a, tb = typeof b;
        if (ta === 'number' || tb === 'number' || ta === 'bigint' || tb === 'bigint') return (ta === 'number' || ta === 'bigint') && (tb === 'number' || tb === 'bigint') && a == b;   // eslint-disable-line eqeqeq
        if (ta === 'object' && typeof a.equals === 'function') return !!a.equals(b);
        if (isV(a) && isV(b)) return a.X === b.X && a.Y === b.Y && a.Z === b.Z;
        return false;
      }
      function strHash(s){ let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }
      const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer), F32 = new Float32Array(1), I32A = new Int32Array(F32.buffer);
      const dblHash = v => { if (v === 0 && !Object.is(v, -0)) return 0; F64[0] = v !== v ? NaN : v; return (U32[0] ^ U32[1]) | 0; };
      function hcAny(x, p){
        if (x == null) return 0;
        switch (typeof x) {
          case 'string': return strHash(x);
          case 'number': if (p === 'double') return dblHash(x); if (p === 'float') { F32[0] = x; return I32A[0]; } return Number.isInteger(x) && x >= -2147483648 && x <= 2147483647 ? x | 0 : dblHash(x);
          case 'bigint': return Number(BigInt.asIntN(32, x ^ (BigInt.asUintN(64, x) >> 32n)));
          case 'boolean': return x ? 1231 : 1237;
          case 'object': return typeof x.hashCode === 'function' ? x.hashCode() | 0 : isV(x) ? (Math.imul(31, Math.imul(31, dblHash(x.X)) + dblHash(x.Y)) + dblHash(x.Z)) | 0 : ih(x);
          case 'function': return ih(x);
        }
        return 0;
      }
      function cmpAny(a, b){
        if (a == null || b == null) throw npe('compareTo');
        const ta = typeof a, tb = typeof b;
        if ((ta === 'number' || ta === 'bigint') && (tb === 'number' || tb === 'bigint')) return a < b ? -1 : a > b ? 1 : (a !== a ? (b !== b ? 0 : 1) : b !== b ? -1 : 0);
        if (ta === 'string' && tb === 'string') return strCmp(a, b);
        if (ta === 'boolean' && tb === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
        if (ta === 'object' && typeof a.compareTo === 'function') return a.compareTo(b) | 0;
        throw new EX.ClassCastException('эти значения нельзя сравнить (нет compareTo): ' + jstr(a) + ' и ' + jstr(b));
      }
      function strCmp(a, b){ const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { const d = a.charCodeAt(i) - b.charCodeAt(i); if (d) return d; } return a.length - b.length; }
      // ── Class (getClass(), Foo.class) ──
      const CLSO = new Map();
      function clsObj(C){
        if (typeof C === 'string') { let o = CLSO.get(C); if (!o) { const n = C; o = { getSimpleName: () => n.split('.').pop().replace(/<.*/, ''), getName: () => (/^(int|long|short|byte|char|float|double|boolean|void)$/.test(n) ? n : 'java.lang.' + n), toString: () => (/^(int|long|short|byte|char|float|double|boolean|void)$/.test(n) ? n : 'class java.lang.' + n), isInstance: x => inst(x, n), equals(x){ return x === this; }, hashCode: () => strHash(n) }; CLSO.set(C, o); } return o; }
        let o = CLSO.get(C);
        if (!o) { o = { getSimpleName: () => (C.$q || C.name || '').split('.').pop(), getName: () => fqName(C), toString: () => (C.$isI ? 'interface ' : 'class ') + fqName(C), isInstance: x => inst(x, C), equals(x){ return x === this; }, hashCode: () => ih(C), $C: C }; CLSO.set(C, o); }
        return o;
      }
      // ── проверка типа (instanceof) и приведение ──
      const LIBCLS = {};   // имя → класс библиотеки (заполняется ниже)
      function inst(x, T){
        if (x == null) return false;
        if (typeof T === 'function') {
          if (T.$isI) { for (let C = x.constructor; C; C = Object.getPrototypeOf(C)) { if (C === T) return true; if (C.$ifs && C.$ifs.has(T)) return true; } return x.$iface === T || (x.$ifaces && x.$ifaces.has(T)); }
          if (x instanceof T) return true;
          return false;
        }
        switch (T) {
          case 'Object': return true;
          case 'Integer': case 'Short': case 'Byte': return typeof x === 'number' && Number.isInteger(x);
          case 'Long': return typeof x === 'bigint';
          case 'Double': case 'Float': return typeof x === 'number';
          case 'Number': return typeof x === 'number' || typeof x === 'bigint';
          case 'String': case 'CharSequence': return typeof x === 'string' || (T === 'CharSequence' && x instanceof LIBCLS.StringBuilder);
          case 'Character': return x instanceof JChar;
          case 'Boolean': return typeof x === 'boolean';
          case 'Comparable': return typeof x === 'number' || typeof x === 'string' || typeof x === 'bigint' || typeof x === 'boolean' || (typeof x === 'object' && typeof x.compareTo === 'function');
          case 'Runnable': case 'Function': case 'Supplier': case 'Consumer': case 'Predicate': case 'BiFunction': case 'Comparator': case 'Callable': return typeof x === 'function' || (typeof x === 'object' && hasLibI(x, T));
          case 'Vector3': return isV(x);
          case 'Part': return typeof x === 'object' && typeof x.IsA === 'function' && x.IsA('BasePart');
          case 'Player': return typeof x === 'object' && 'UserId' in x;
        }
        if (T[0] === '[') { const tag = T.slice(1); if (tag === 'L') return Array.isArray(x); if (tag === 'C' || tag === 'Z') return Array.isArray(x) && x.$jt === tag; const A = { I: Int32Array, J: BigInt64Array, D: Float64Array, F: Float32Array, S: Int16Array, B: Int8Array }[tag]; return !!A && x instanceof A; }
        const C = LIBCLS[T];
        if (C) return x instanceof C || (C.$isI && hasLibI(x, T));
        return hasLibI(x, T);
      }
      const hasLibI = (x, n) => { for (let C = x && x.constructor; C; C = Object.getPrototypeOf(C)) if (C.$lifs && C.$lifs.includes(n)) return true; return false; };
      function cast(x, T){
        if (x == null || inst(x, T)) return x;
        const tn = typeof T === 'function' ? fqName(T) : T;
        throw new EX.ClassCastException('нельзя привести ' + typeName(x) + ' к ' + tn);
      }
      const typeName = x => x == null ? 'null' : typeof x === 'number' ? (Number.isInteger(x) ? 'java.lang.Integer' : 'java.lang.Double') : typeof x === 'string' ? 'java.lang.String' : typeof x === 'bigint' ? 'java.lang.Long' :
        typeof x === 'boolean' ? 'java.lang.Boolean' : Array.isArray(x) || ArrayBuffer.isView(x) ? arrName(x) : x.constructor ? fqName(x.constructor) : 'Object';
      // ── JS-ошибка → исключение Java (catch ловит по классам Java) ──
      function exc(e){
        if (e instanceof Throwable || e == null || typeof e !== 'object' || e.$exit) return e;
        const m = String(e.message || ''), t = e instanceof TypeError ? (/null|undefined/.test(m) ? 'NullPointerException' : 'RuntimeException') : e instanceof RangeError ? (/call stack|recursion/i.test(m) ? 'StackOverflowError' : /array length|Invalid typed array length/i.test(m) ? 'OutOfMemoryError' : 'RuntimeException') : 'RuntimeException';
        const x = new EX[t](jsMsg(e));
        x.stack = e.stack; x.$js = e;
        return x;
      }
      function jsMsg(e){
        const m = String(e && e.message || e);
        let r;
        if ((r = /Cannot read propert(?:y|ies) of (?:null|undefined)(?: \(reading '([^']*)'\))?/.exec(m)) || (r = /can't access property "([^"]*)",? .* is (?:null|undefined)/.exec(m)) || (r = /(?:null|undefined) is not an object \(evaluating '[^']*?\.?([^'.]*)'\)/.exec(m))) return 'обращение к «' + fieldNm(r[1]) + '» у null';
        if ((r = /Cannot set propert(?:y|ies) of (?:null|undefined)(?: \(setting '([^']*)'\))?/.exec(m))) return 'запись «' + fieldNm(r[1]) + '» в null';
        if ((r = /([\w$.\]\["#]+) is not a function/.exec(m))) return 'нет метода «' + r[1].split('.').pop().replace(/[\]["#]/g, '') + '»';
        if (/is not iterable/.test(m)) return 'это нельзя перебрать в for-each';
        if (/Maximum call stack|too much recursion/i.test(m)) return 'бесконечная рекурсия: метод вызывает сам себя без конца';
        if (/BigInt/.test(m) && /mix/.test(m)) return 'long и другое число смешались — приведи тип: (long) x или (int) y';
        if (/Invalid (typed )?array length/.test(m)) return 'слишком большой массив';
        return m;
      }
      const fieldNm = s => !s ? '?' : s[0] === '#' ? s.slice(1) : s === 'length' ? 'length' : s;
      // ── проверки и мелочи для переведённого кода ──
      function dop(op, a, b){   // операция над значениями неизвестного типа (мир, Object)
        if (typeof a === 'bigint' || typeof b === 'bigint') {
          if (typeof a === 'number' || typeof b === 'number') { if (!Number.isInteger(a) && typeof a === 'number' || !Number.isInteger(b) && typeof b === 'number') { a = Number(a); b = Number(b); } else { a = BigInt(a); b = BigInt(b); } }
        }
        if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return jstr(a) + jstr(b);
        if (a == null || b == null) throw npe(op);
        switch (op) {
          case '+': return typeof a === 'bigint' ? BigInt.asIntN(64, a + b) : a + b;
          case '-': return typeof a === 'bigint' ? BigInt.asIntN(64, a - b) : a - b;
          case '*': return typeof a === 'bigint' ? BigInt.asIntN(64, a * b) : a * b;
          case '/': if (typeof a === 'bigint') { if (b === 0n) throw new EX.ArithmeticException('деление на ноль'); return BigInt.asIntN(64, a / b); } return a / b;
          case '%': if (typeof a === 'bigint') { if (b === 0n) throw new EX.ArithmeticException('деление на ноль'); return a % b; } return a % b;
          case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
          case '&': return typeof a === 'boolean' ? !!(a & b) : a & b;
          case '|': return typeof a === 'boolean' ? !!(a | b) : a | b;
          case '^': return typeof a === 'boolean' ? a !== b : a ^ b;
          case '<<': return typeof a === 'bigint' ? BigInt.asIntN(64, a << BigInt(Number(b) & 63)) : a << b;
          case '>>': return typeof a === 'bigint' ? a >> BigInt(Number(b) & 63) : a >> b;
          case '>>>': return typeof a === 'bigint' ? BigInt.asIntN(64, BigInt.asUintN(64, a) >> BigInt(Number(b) & 63)) : (a >>> b) | 0;
        }
        throw new EX.UnsupportedOperationException(op);
      }
      function toNum(x, t){
        if (x == null) throw npe('(' + t + ')');
        if (x instanceof JChar) x = x.c;
        if (typeof x === 'string' && x.length === 1 && t !== 'String') x = x.charCodeAt(0);
        if (typeof x === 'boolean') throw new EX.ClassCastException('boolean нельзя привести к ' + t);
        if (typeof x === 'object' && x !== null && typeof x.valueOf === 'function') x = x.valueOf();
        if (typeof x !== 'number' && typeof x !== 'bigint') throw new EX.ClassCastException(typeName(x) + ' нельзя привести к ' + t);
        switch (t) {
          case 'long': return typeof x === 'bigint' ? x : d2l(x);
          case 'int': return typeof x === 'bigint' ? Number(BigInt.asIntN(32, x)) : d2i(x);
          case 'short': return (toNum(x, 'int') << 16) >> 16;
          case 'byte': return (toNum(x, 'int') << 24) >> 24;
          case 'char': return CH(toNum(x, 'int') & 0xFFFF);
          case 'float': return Math.fround(Number(x));
          default: return Number(x);
        }
      }
      const d2i = v => v !== v ? 0 : v >= 2147483647 ? 2147483647 : v <= -2147483648 ? -2147483648 : (v < 0 ? Math.ceil(v) : Math.floor(v)) | 0;
      const d2l = v => v !== v ? 0n : v >= 9223372036854775807 ? 9223372036854775807n : v <= -9223372036854775808 ? -9223372036854775808n : BigInt(Math.trunc(v));
      const arith = () => new EX.ArithmeticException('деление на ноль');
      const H = {
        str: jstr, ds: dstr, fs: fstr, sn: s => s == null ? 'null' : s, sn1: s => { if (s == null) throw npe('new String'); return s; },
        ub(x){ if (x == null) throw new EX.NullPointerException('распаковка null (Integer, Double … без значения)'); return x instanceof JChar ? x.c : x; },
        bc,
        toNum, toBool(x){ if (x == null) throw npe('boolean'); if (typeof x !== 'boolean') throw new EX.ClassCastException(typeName(x) + ' — не boolean'); return x; },
        ord: c => typeof c === 'string' ? c.charCodeAt(0) | 0 : +c | 0, chr: n => CH(n & 0xFFFF),
        d2i, d2l, l2i: v => Number(BigInt.asIntN(32, v)),
        idiv(a, b){ if (b === 0) throw arith(); return (a / b) | 0; },
        imod(a, b){ if (b === 0) throw arith(); return (a % b) | 0; },
        ldiv(a, b){ if (b === 0n) throw arith(); return BigInt.asIntN(64, a / b); },
        lmod(a, b){ if (b === 0n) throw arith(); return a % b; },
        lshl: (a, n) => BigInt.asIntN(64, a << BigInt(n & 63)), lshr: (a, n) => a >> BigInt(n & 63), lushr: (a, n) => BigInt.asIntN(64, BigInt.asUintN(64, a) >> BigInt(n & 63)),
        dop, jeq: (a, b) => a == null || b == null ? a == b : typeof a === 'object' || typeof b === 'object' ? a === b : a == b,   // eslint-disable-line eqeqeq
        beq(a, o, pa, po){ if (a == null) throw npe('equals'); if (o == null) return false; if (po && po !== pa) return false; const pt = typeof o; if (pa === 'long') return pt === 'bigint' && o === a; if (pa === 'char') return pt === 'string' && o === a; if (pa === 'boolean') return o === a; if (pa === 'int' || pa === 'short' || pa === 'byte') return pt === 'number' && Number.isInteger(o) && o === a; return pt === 'number' && (o === a || (o !== o && a !== a)); },
        cmp: cmpAny, hc: (x, p) => hcAny(x, p), eq: jeq,
        eqn(a, b){ if (a == null) throw npe('equals'); return jeq(a, b); },
        hcn(x){ if (x == null) throw npe('hashCode'); return hcAny(x); },
        tostr(x){ if (x == null) throw npe('toString'); return jstr(x); },
        getClass(x){ if (x == null) throw npe('getClass'); return clsObj(typeof x === 'object' && x.constructor && x.$jv ? x.constructor : typeName(x).replace(/^java\.lang\./, '')); },
        cls: C => clsObj(C),
        // массивы: int[] — Int32Array, long[] — BigInt64Array, double[] — Float64Array, char[] / boolean[] / объекты — обычный массив
        na(tag, n){
          n = n | 0; if (n < 0) throw new EX.NegativeArraySizeException('размер массива меньше нуля: ' + n); if (n > 5e7) throw new EX.OutOfMemoryError('слишком большой массив: ' + n);
          switch (tag) {
            case 'I': return new Int32Array(n); case 'J': return new BigInt64Array(n); case 'D': return new Float64Array(n); case 'F': return new Float32Array(n);
            case 'S': return new Int16Array(n); case 'B': return new Int8Array(n);
            case 'C': { const a = new Array(n).fill(CH(0)); a.$jt = 'C'; return a; }
            case 'Z': { const a = new Array(n).fill(false); a.$jt = 'Z'; return a; }
          }
          return new Array(n).fill(null);
        },
        nam(tag, dims, extra){ const mk = k => k === dims.length - 1 ? H.na(extra ? 'L' : tag, dims[k]) : Array.from({ length: H.na('L', dims[k]).length }, () => mk(k + 1)); return mk(0); },
        mka(tag, items){ switch (tag) { case 'I': return Int32Array.from(items); case 'J': return BigInt64Array.from(items); case 'D': return Float64Array.from(items); case 'F': return Float32Array.from(items); case 'S': return Int16Array.from(items); case 'B': return Int8Array.from(items); } const a = items.slice(); if (tag === 'C' || tag === 'Z') a.$jt = tag; return a; },
        ag(a, i){ if (a == null) throw npe('[ ]'); if (i >>> 0 < a.length) return a[i]; throw aioobe(i, a.length); },
        ap(a, i, v){ if (a == null) throw npe('[ ]'); if (i >>> 0 < a.length) return (a[i] = v); throw aioobe(i, a.length); },
        aclone(a){ if (a == null) throw npe('clone'); const b = a.slice(); if (a.$jt) b.$jt = a.$jt; return b; },
        chars(a, off, cnt){ if (a == null) throw npe('char[]'); if (typeof a === 'string') return a; const s = off === undefined ? 0 : off, e = cnt === undefined ? a.length : s + cnt; if (s < 0 || e > a.length || s > e) throw sioobe(s, a.length); let r = ''; for (let i = s; i < e; i++) r += a[i]; return r; },
        join(sep, xs){ if (xs == null) throw npe('join'); const out = []; for (const x of it(xs)) out.push(jstr(x)); return out.join(sep == null ? 'null' : sep); },
        prop(k, d){ const P = { 'java.version': '21', 'java.specification.version': '21', 'java.vendor': 'dan4ik37', 'os.name': 'D37', 'os.arch': 'wasm', 'line.separator': '\n', 'file.separator': '/', 'path.separator': ':', 'user.name': 'player', 'user.dir': '/', 'file.encoding': 'UTF-8' }; return Object.prototype.hasOwnProperty.call(P, k) ? P[k] : d === undefined ? null : d; },
        // поля и методы у значения неизвестного типа (объекты мира, Object)
        gf(o, n){ if (o == null) throw npe(n); if (o.$jv && ('#' + n) in o) return o['#' + n]; return o[n]; },
        sf(o, n, v){ if (o == null) throw npe(n); if (o.$jv && ('#' + n) in o) return (o['#' + n] = v); o[n] = v; return v; },
        dc(o, n, a){ return dyncall(o, n, a); },
        // лямбда → обработчик мира: ошибка внутри — по-русски со строкой Java (а не строкой JS), ждущая лямбда — сопрограммой
        js(x, d){
          if (typeof x !== 'function' || !this || typeof this.rep !== 'function') return toJS(x, d);
          if (x.$w) return x.$w;
          const rt = this, f = x;
          const w = function (...a){
            if (rt.ctx && rt.ctx.setCurrent) rt.ctx.setCurrent(rt.name);
            try { const r = f.apply(this, a); if (r && typeof r.next === 'function' && typeof r.throw === 'function') { coRun(r, rt, null); return undefined; } return toJS(r); }
            catch (e) { if (!(e && e.$exit)) rt.rep(e); return undefined; }
          };
          try { Object.defineProperty(f, '$w', { value: w }); } catch (e) {}
          return w;
        },
        jlist: a => Array.isArray(a) ? LIBCLS.ArrayList.wrap(a) : a,
        cast, inst, exc,
        isExc(e, T){ e = exc(e); if (e == null || e.$exit || typeof T !== 'function') return false; return e instanceof T; },
        thr(e){ if (e == null) throw new EX.NullPointerException('throw null'); throw e; },
        swf(v){ throw new EX.RuntimeException('switch: нет ветки для «' + jstr(v) + '» (добавь default)'); },
        nsw(v){ if (v == null) throw npe('switch'); return v; },
        enumOf(E, n){ if (n == null) throw new EX.NullPointerException('valueOf(null)'); const v = (E.$values || []).find(x => x.$name === n); if (!v) throw new EX.IllegalArgumentException('нет такого значения: ' + (E.$q || '') + '.' + n); return v; },
        pd(o, props){ for (const k of Object.keys(props)) if (!Object.prototype.hasOwnProperty.call(o, k)) Object.defineProperty(o, k, { value: props[k], writable: true, configurable: true, enumerable: false }); },
        impl(C, ifs, lifs){
          const all = new Set(C.$ifs || []);
          const add = I => { if (!I || all.has(I)) return; all.add(I); for (const J of I.$ifs || []) add(J); };
          for (const I of ifs) add(I);
          Object.defineProperty(C, '$ifs', { value: all, configurable: true, writable: true });
          if (lifs && lifs.length) Object.defineProperty(C, '$lifs', { value: (C.$lifs || []).concat(lifs), configurable: true, writable: true });
          for (const I of all) for (const k of Object.getOwnPropertyNames(I.prototype)) if (k !== 'constructor' && !(k in C.prototype)) Object.defineProperty(C.prototype, k, Object.getOwnPropertyDescriptor(I.prototype, k));
        },
        lam(I, name, fn){ const o = Object.create(I.prototype); Object.defineProperty(o, name, { value: fn, writable: true, configurable: true }); Object.defineProperty(o, '$iface', { value: I }); return o; },
        ci(f, name, ...a){ if (f == null) throw npe(name); return typeof f === 'function' ? f(...a) : f[name](...a); },
        kd(c, k1, k2){ if (c && typeof c === 'object') { if (k1) c.$k = k1; if (k2) c.$kv = k2; } return c; },
        close(r, prim){ if (r == null) return; const f = () => typeof r === 'function' ? r() : r.close(); if (prim) { try { f(); } catch (e) { if (prim.addSuppressed) prim.addSuppressed(exc(e)); } } else f(); },
        millis: () => BigInt(Date.now()), nanos: () => BigInt(Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) * 1e6)),
        clock: () => ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - T0) / 1000,
        // Math для long и «точные» операции
        labs: v => v < 0n ? BigInt.asIntN(64, -v) : v, lmax: (a, b) => a > b ? a : b, lmin: (a, b) => a < b ? a : b,
        roundf: v => v !== v ? 0 : d2i(Math.floor(v + 0.5)), roundd: v => v !== v ? 0n : d2l(Math.floor(v + 0.5)),
        rint(v){ const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; },
        ulp: v => { if (!isFinite(v)) return Math.abs(v); const a = Math.abs(v); if (a === 0) return Number.MIN_VALUE; const e = Math.floor(Math.log2(a)); return Math.pow(2, Math.max(e - 52, -1074)); },
        floorDiv(a, b, t){ if (t === 'long') { if (b === 0n) throw arith(); let q = a / b; if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q--; return BigInt.asIntN(64, q); } if (b === 0) throw arith(); return Math.floor(a / b) | 0; },
        floorMod(a, b, t){ if (t === 'long') { if (b === 0n) throw arith(); const m = a % b; return m !== 0n && ((m < 0n) !== (b < 0n)) ? m + b : m; } if (b === 0) throw arith(); const m = a % b; return (m !== 0 && ((m < 0) !== (b < 0)) ? m + b : m) | 0; },
        ceilDiv(a, b, t){ if (t === 'long') { if (b === 0n) throw arith(); let q = a / b; if ((a % b !== 0n) && ((a < 0n) === (b < 0n))) q++; return q; } if (b === 0) throw arith(); return Math.ceil(a / b) | 0; },
        addExact: (a, b, t) => exact(t === 'long' ? a + b : a + b, t), subtractExact: (a, b, t) => exact(a - b, t), multiplyExact: (a, b, t) => exact(t === 'long' ? a * b : a * b, t),
        negateExact: (a, t) => exact(-a, t), incrementExact: (a, t) => exact(t === 'long' ? a + 1n : a + 1, t), decrementExact: (a, t) => exact(t === 'long' ? a - 1n : a - 1, t),
        absExact: (a, t) => exact(a < 0 ? -a : a, t), toIntExact: v => exact(Number(v), 'int'),
        clamp(v, a, b, t){ if (a > b) throw new EX.IllegalArgumentException(jstr(a) + ' > ' + jstr(b)); const r = v < a ? a : v > b ? b : v; return t === 'int' && typeof r === 'bigint' ? Number(r) : r; },
        X(n){ const c = XR.get(n); if (!c) throw new EX.IllegalStateException('класс «' + n + '» из другого скрипта не загрузился'); return c; },
      };
      const exact = (r, t) => { if (t === 'long') { if (r > 9223372036854775807n || r < -9223372036854775808n) throw new EX.ArithmeticException('long переполнился'); return r; } if (r > 2147483647 || r < -2147483648) throw new EX.ArithmeticException('int переполнился'); return r; };
      const T0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      // перебор: массив, коллекция Java, Iterable своего класса (iterator()), строка
      function it(x){
        if (x == null) throw npe('for-each');
        if (typeof x[Symbol.iterator] === 'function') return x;
        if (typeof x.iterator === 'function') { const I = x.iterator(); return { [Symbol.iterator]: () => ({ next: () => I.hasNext() ? { value: I.next(), done: false } : { value: undefined, done: true } }) }; }
        throw new EX.ClassCastException('это нельзя перебрать в for-each (нужен массив или коллекция)');
      }
      H.it = it;
      // значение Java → значение для мира (JS): long → число, List → массив, Map → объект
      function toJS(x, d){
        if (x == null || typeof x !== 'object') return typeof x === 'bigint' ? Number(x) : x;
        if ((d | 0) > 20) return null;
        if (LIBCLS.Map && x instanceof LIBCLS.AbstractMapJ) { const o = {}; for (const e of x.entrySet()) o[String(jstr(e.getKey()))] = toJS(e.getValue(), (d | 0) + 1); return o; }
        if (LIBCLS.JColl && x instanceof LIBCLS.JColl) return [...x].map(v => toJS(v, (d | 0) + 1));
        if (x instanceof BigInt64Array) return Array.from(x, Number);
        return x;
      }
      // вызов метода «во время работы» (тип не известен при переводе)
      function dyncall(o, n, a){
        if (o == null) throw npe(n + '()');
        const t = typeof o;
        if (t === 'string') { const f = SX[n]; if (f) return f(o, ...a); if (n === 'length') return o.length; throw new EX.RuntimeException('у String нет метода ' + n); }
        if (t === 'number' || t === 'bigint' || t === 'boolean') {
          switch (n) {
            case 'intValue': return t === 'bigint' ? Number(BigInt.asIntN(32, o)) : d2i(o); case 'longValue': return t === 'bigint' ? o : d2l(o);
            case 'doubleValue': case 'floatValue': return Number(o); case 'booleanValue': case 'charValue': return o;
            case 'compareTo': return cmpAny(o, a[0]); case 'equals': return jeq(o, a[0]); case 'hashCode': return hcAny(o); case 'toString': return jstr(o);
          }
          throw new EX.RuntimeException('у числа нет метода ' + n);
        }
        if (t === 'function') return o(...a);
        if (Array.isArray(o) && !o.$jv && LIBCLS.ArrayList.prototype[n]) return LIBCLS.ArrayList.wrap(o)[n](...a);
        const f = o[n];
        if (typeof f === 'function') return o.$jv ? f.apply(o, a) : f.apply(o, a.map(x => toJS(x)));
        // как в Java Beans: getName() → Name, setName(v), isAnchored()
        let m;
        if ((m = /^(get|is)([A-Z]\w*)$/.exec(n)) && !a.length) { const k = m[2]; if (k in o) return o[k]; const k2 = k[0].toLowerCase() + k.slice(1); if (k2 in o) return o[k2]; }
        if ((m = /^set([A-Z]\w*)$/.exec(n)) && a.length === 1) { const k = m[1]; o[k in o ? k : k[0].toLowerCase() + k.slice(1)] = toJS(a[0]); return; }
        if (OBJM[n]) return OBJM[n](o, ...a);
        throw new EX.RuntimeException('нет метода «' + n + '»' + (o.ClassName ? ' у ' + o.ClassName : ''));
      }
      const OBJM = { equals: (o, x) => jeq(o, x), hashCode: o => hcAny(o), toString: o => jstr(o), getClass: o => H.getClass(o) };
      // перегрузки: выбор варианта по значениям (когда при переводе не ясно)
      function fits(v, t, strict){
        if (t === '*') return true;
        if (typeof t === 'function') return v == null || inst(v, t);
        if (v == null) return !/^[IJDCZ]$/.test(t);
        switch (t) {
          case 'I': return typeof v === 'number' && Number.isInteger(v);
          case 'J': return typeof v === 'bigint' || (!strict && typeof v === 'number' && Number.isInteger(v));
          case 'D': return typeof v === 'number';
          case 'C': return typeof v === 'string' && v.length === 1;
          case 'Z': return typeof v === 'boolean';
          case 'S': return typeof v === 'string';
        }
        return inst(v, t[0] === '[' ? t : t);
      }
      H.ovs = (a, sigs, name) => { for (const strict of [true, false]) for (let i = 0; i < sigs.length; i++) { const [mn, mx, ts] = sigs[i]; if (a.length >= mn && a.length <= mx && a.every((v, j) => j >= ts.length || fits(v, ts[j], strict))) return i; } throw new EX.IllegalArgumentException('нет подходящего варианта ' + name + '(' + a.map(x => typeName(x).replace(/^java\.lang\./, '')).join(', ') + ')'); };
      H.ovk = H.ovs;
      // ── String: методы Java (у строк JS свои с другим смыслом — поэтому отдельно) ──
      const chk = (s, n) => { if (s == null) throw npe(n + '()'); return s; };
      const ch1 = c => typeof c === 'number' ? String.fromCodePoint(c) : c == null ? 'null' : String(c);
      // регулярные выражения Java → JS (почти одинаковые; \p{Alpha}, (?<name>…), притяжательные ++ — упрощаем)
      const RXC = new Map();
      function jre(re, flags){
        const key = re + '/' + (flags || '');
        let r = RXC.get(key);
        if (!r) {
          let s = String(re).replace(/\\p\{(Alpha|L)\}/g, '\\p{L}').replace(/\\p\{Digit\}/g, '\\d').replace(/\\p\{Upper\}/g, '\\p{Lu}').replace(/\\p\{Lower\}/g, '\\p{Ll}').replace(/\\p\{Punct\}/g, '\\p{P}').replace(/\\p\{Alnum\}/g, '[\\p{L}\\p{N}]')
            .replace(/([*+?}])\+/g, '$1').replace(/\\Q([\s\S]*?)(\\E|$)/g, (m, x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).replace(/\\z/g, '$').replace(/\\Z/g, '(?=\\n?$)').replace(/\\A/g, '^');
          try { r = new RegExp(s, (flags || '') + 'u'); } catch (e) { try { r = new RegExp(s, flags || ''); } catch (e2) { throw new EX.IllegalArgumentException('неверное регулярное выражение «' + re + '»: ' + e2.message); } }
          if (RXC.size > 200) RXC.clear();
          RXC.set(key, r);
        }
        return r;
      }
      const jrep = r => String(r).replace(/\$\{(\w+)\}/g, '$<$1>').replace(/\\\$/g, '$$$$').replace(/\\\\/g, '\\');
      const SX = {
        charAt(s, i){ chk(s, 'charAt'); if (!(i >>> 0 < s.length)) throw sioobe(i, s.length); return s[i]; },
        isEmpty: s => chk(s, 'isEmpty').length === 0, isBlank: s => !chk(s, 'isBlank').trim().length,
        substring(s, a, b){ chk(s, 'substring'); const e = b === undefined ? s.length : b; if (a < 0 || e > s.length || a > e) throw sioobe(a < 0 || a > s.length ? a : e, s.length); return s.slice(a, e); },
        subSequence(s, a, b){ return SX.substring(s, a, b); },
        indexOf: (s, x, from) => chk(s, 'indexOf').indexOf(ch1(x), from === undefined ? 0 : Math.max(0, from)),
        lastIndexOf: (s, x, from) => from === undefined ? chk(s, 'lastIndexOf').lastIndexOf(ch1(x)) : chk(s, 'lastIndexOf').lastIndexOf(ch1(x), from),
        contains: (s, x) => { chk(s, 'contains'); if (x == null) throw npe('contains'); return s.includes(jstr(x)); },
        startsWith: (s, x, off) => chk(s, 'startsWith').startsWith(x, off || 0), endsWith: (s, x) => chk(s, 'endsWith').endsWith(x),
        equals: (s, o) => chk(s, 'equals') === o, equalsIgnoreCase: (s, o) => o != null && chk(s, 'equalsIgnoreCase').toLowerCase() === String(o).toLowerCase(),
        compareTo(s, o){ chk(s, 'compareTo'); if (o == null) throw npe('compareTo'); return strCmp(s, o); },
        compareToIgnoreCase(s, o){ chk(s, 'compareToIgnoreCase'); if (o == null) throw npe('compareToIgnoreCase'); return strCmp(s.toUpperCase().toLowerCase(), String(o).toUpperCase().toLowerCase()); },
        toUpperCase: s => chk(s, 'toUpperCase').toUpperCase(), toLowerCase: s => chk(s, 'toLowerCase').toLowerCase(),
        trim: s => chk(s, 'trim').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, ''), strip: s => chk(s, 'strip').trim(), stripLeading: s => chk(s, 'stripLeading').trimStart(), stripTrailing: s => chk(s, 'stripTrailing').trimEnd(),
        replace(s, a, b){ chk(s, 'replace'); if (a == null || b == null) throw npe('replace'); return s.split(jstr(a)).join(jstr(b)); },
        replaceAll: (s, re, rep) => chk(s, 'replaceAll').replace(new RegExp(jre(re).source, jre(re).flags + 'g'), jrep(rep)),
        replaceFirst: (s, re, rep) => chk(s, 'replaceFirst').replace(jre(re), jrep(rep)),
        split(s, re, lim){   // как Pattern.split в Java: пустые в конце убираются, пустое «совпадение» в начале не даёт пустой строки
          chk(s, 'split');
          if (re == null) throw npe('split');
          const limit = lim === undefined ? 0 : lim | 0, rx = jre(re), r = new RegExp(rx.source, rx.flags + 'g');
          const list = [];
          let index = 0, m;
          while ((m = r.exec(s))) {
            const st = m.index, en = st + m[0].length;
            if (m[0] === '') r.lastIndex++;
            if (limit > 0 && list.length >= limit - 1) break;
            if (!(index === 0 && st === 0 && en === 0)) { list.push(s.slice(index, st)); index = en; }
            if (r.lastIndex > s.length) break;
          }
          if (index === 0) return [s];
          list.push(s.slice(index));
          if (limit === 0) while (list.length && list[list.length - 1] === '') list.pop();
          return list;
        },
        toCharArray: s => { const a = chk(s, 'toCharArray').split(''); a.$jt = 'C'; return a; },
        chars: s => LIBCLS.IntStream.ofArr(Int32Array.from(chk(s, 'chars'), c => c.charCodeAt(0))),
        matches: (s, re) => { const r = jre(re); const m = new RegExp('^(?:' + r.source + ')$', r.flags).exec(chk(s, 'matches')); return !!m; },
        repeat(s, n){ chk(s, 'repeat'); if (n < 0) throw new EX.IllegalArgumentException('repeat: ' + n); return s.repeat(n); },
        concat: (s, x) => { chk(s, 'concat'); if (x == null) throw npe('concat'); return s + x; },
        hashCode: s => strHash(chk(s, 'hashCode')), toString: s => chk(s, 'toString'), intern: s => chk(s, 'intern'),
        lines: s => LIBCLS.Stream.ofArr(chk(s, 'lines').split(/\r?\n/).filter((x, i, a) => i < a.length - 1 || x !== '')),
        codePointAt: (s, i) => { chk(s, 'codePointAt'); if (!(i >>> 0 < s.length)) throw sioobe(i, s.length); return s.codePointAt(i); },
        formatted: (s, args, tags) => jformat(s, args, tags),
        contentEquals: (s, x) => chk(s, 'contentEquals') === jstr(x),
        indent: (s, n) => chk(s, 'indent').split(/\r?\n/).filter((x, i, a) => i < a.length - 1 || x !== '').map(l => n >= 0 ? ' '.repeat(n) + l : l.replace(new RegExp('^\\s{0,' + (-n) + '}'), '')).join('\n') + '\n',
        length: s => chk(s, 'length').length,
        getBytes: s => Int8Array.from(new TextEncoder().encode(chk(s, 'getBytes'))),
      };
      // ── String.format / printf (как Formatter в Java: %d %s %f %.2f %5d %-5s %05d %x %c %b %e %n %%, флаги - + 0 , ( #) ──
      function jformat(fmt, args, tags){
        if (fmt == null) throw npe('format');
        args = args || []; tags = tags || '';
        let next = 0, lastIdx = -1;
        return String(fmt).replace(/%(\d+\$|<)?([-#+ 0,(]*)(\d+)?(\.\d+)?([a-zA-Z%])/g, (m, idx, flags, width, prec, conv) => {
          if (conv === 'n') return '\n';
          if (conv === '%') return pad('%', width, flags);
          let i;
          if (idx === '<') i = lastIdx; else if (idx) i = parseInt(idx, 10) - 1; else i = next++;
          if (i < 0 || i >= args.length) throw new EX.IllegalArgumentException('в формате «' + m + '» нет значения (передано ' + args.length + ')');
          lastIdx = i;
          const v = args[i], tag = tags[i] || 'O';
          const p = prec ? +prec.slice(1) : -1;
          const up = conv >= 'A' && conv <= 'Z';
          let s;
          switch (conv.toLowerCase()) {
            case 'b': s = v == null ? 'false' : typeof v === 'boolean' ? String(v) : 'true'; if (p >= 0) s = s.slice(0, p); break;
            case 'h': s = v == null ? 'null' : hex(hcAny(v)); break;
            case 's': s = tag === 'D' ? dstr(v) : tag === 'F' ? fstr(v) : jstr(v); if (p >= 0) s = s.slice(0, p); break;
            case 'c': if (v == null) s = 'null'; else if (typeof v === 'number') s = String.fromCodePoint(v); else if (typeof v === 'string' && v.length === 1) s = v; else if (v instanceof JChar) s = v.c; else throw badConv(conv, v, tag); break;
            case 'd': {
              if (!isIntegral(v, tag)) throw badConv(conv, v, tag);
              const neg = v < 0; let a = String(neg ? -BigInt(v) : BigInt(v));
              if (flags.includes(',')) a = groupStr(a);
              s = signed(a, neg, flags, width);
              break;
            }
            case 'o': case 'x': {
              if (!isIntegral(v, tag)) throw badConv(conv, v, tag);
              const big = typeof v === 'bigint' || tag === 'J';
              s = big ? BigInt.asUintN(64, BigInt(v)).toString(conv === 'o' ? 8 : 16) : ((v | 0) >>> 0).toString(conv.toLowerCase() === 'o' ? 8 : 16);
              if (flags.includes('#')) s = (conv.toLowerCase() === 'o' ? '0' : '0x') + s;
              if (flags.includes('0') && width) s = s.padStart(+width, '0');
              break;
            }
            case 'f': case 'e': case 'g': {
              if (typeof v !== 'number' || tag === 'I' || tag === 'J' || tag === 'C') { if (v == null) { s = 'null'; break; } throw badConv(conv, v, tag); }
              const isF = tag === 'F', P = p < 0 ? 6 : p;
              if (!isFinite(v)) { s = v !== v ? 'NaN' : v > 0 ? (flags.includes('+') ? '+Infinity' : 'Infinity') : (flags.includes('(') ? '(Infinity)' : '-Infinity'); break; }
              let a;
              const lc = conv.toLowerCase();
              if (lc === 'f') a = fixedJ(Math.abs(v), P, isF);
              else if (lc === 'e') a = expJ(Math.abs(v), P, isF);
              else { const PP = P === 0 ? 1 : P; const r = Math.abs(v); const ex = r === 0 ? 0 : Math.floor(Math.log10(r)); a = r !== 0 && (r < 1e-4 || ex >= PP) ? expJ(r, PP - 1, isF) : fixedJ(r, Math.max(0, PP - 1 - ex), isF); }
              if (flags.includes(',') && lc === 'f') a = groupStr(a);
              s = signed(a, v < 0 || Object.is(v, -0), flags, width);
              break;
            }
            case 't': throw new EX.IllegalArgumentException('даты в format (%t) не поддерживаются');
            case 'a': throw new EX.IllegalArgumentException('%a не поддерживается');
            default: throw new EX.IllegalArgumentException('неизвестный формат «' + m + '» (есть %d %s %f %c %b %x %e %n %%)');
          }
          if (up) s = s.toUpperCase();
          return pad(s, width, flags);
        });
      }
      const isIntegral = (v, tag) => tag === 'I' || tag === 'J' || typeof v === 'bigint' || (tag === 'O' && typeof v === 'number' && Number.isInteger(v));
      const badConv = (c, v, tag) => new EX.IllegalArgumentException('%' + c + ' не подходит для ' + ({ I: 'int', J: 'long', D: 'double', F: 'float', C: 'char', Z: 'boolean', S: 'String' }[tag] || typeName(v).replace(/^java\.lang\./, '')) +
        (c === 'd' && (tag === 'D' || tag === 'F') ? ' — для дробных %f (или (int) x)' : c === 'f' && (tag === 'I' || tag === 'J') ? ' — для целых %d (или (double) x)' : ''));
      function signed(a, neg, flags, width){
        let pre = '', post = '';
        if (neg) { if (flags.includes('(')) { pre = '('; post = ')'; } else pre = '-'; }
        else if (flags.includes('+')) pre = '+'; else if (flags.includes(' ')) pre = ' ';
        if (flags.includes('0') && width) a = a.padStart(+width - pre.length - post.length, '0');
        return pre + a + post;
      }
      const pad = (s, width, flags) => !width ? s : flags && flags.includes('-') ? s.padEnd(+width) : s.padStart(+width);
      H.format = jformat;
      // ── StringBuilder ──
      class StringBuilder extends JObject {
        constructor(s){ super(); this.$s = s == null || typeof s === 'number' ? '' : String(s); }
        append(x){ this.$s += x; return this; }
        insert(i, x){ if (i < 0 || i > this.$s.length) throw sioobe(i, this.$s.length); this.$s = this.$s.slice(0, i) + x + this.$s.slice(i); return this; }
        reverse(){ this.$s = [...this.$s].reverse().join(''); return this; }
        toString(){ return this.$s; }
        length(){ return this.$s.length; }
        charAt(i){ return SX.charAt(this.$s, i); }
        setCharAt(i, c){ if (!(i >>> 0 < this.$s.length)) throw sioobe(i, this.$s.length); this.$s = this.$s.slice(0, i) + c + this.$s.slice(i + 1); }
        deleteCharAt(i){ if (!(i >>> 0 < this.$s.length)) throw sioobe(i, this.$s.length); this.$s = this.$s.slice(0, i) + this.$s.slice(i + 1); return this; }
        delete(a, b){ if (a < 0 || a > this.$s.length || a > b) throw sioobe(a, this.$s.length); this.$s = this.$s.slice(0, a) + this.$s.slice(Math.min(b, this.$s.length)); return this; }
        replace(a, b, s){ if (a < 0 || a > this.$s.length || a > b) throw sioobe(a, this.$s.length); this.$s = this.$s.slice(0, a) + s + this.$s.slice(Math.min(b, this.$s.length)); return this; }
        indexOf(s, f){ return this.$s.indexOf(s, f || 0); }
        lastIndexOf(s){ return this.$s.lastIndexOf(s); }
        setLength(n){ if (n < 0) throw sioobe(n, this.$s.length); this.$s = n <= this.$s.length ? this.$s.slice(0, n) : this.$s + CH(0).repeat(n - this.$s.length); }
        isEmpty(){ return !this.$s.length; }
        substring(a, b){ return SX.substring(this.$s, a, b); }
        chars(){ return SX.chars(this.$s); }
        capacity(){ return Math.max(16, this.$s.length); }
        compareTo(o){ return strCmp(this.$s, o.$s); }
      }
      class StringJoiner extends JObject {
        constructor(sep, pre, suf){ super(); this.$sep = jstr(sep); this.$pre = pre == null ? '' : jstr(pre); this.$suf = suf == null ? '' : jstr(suf); this.$a = []; this.$e = null; }
        add(x){ this.$a.push(jstr(x)); return this; }
        setEmptyValue(x){ this.$e = jstr(x); return this; }
        length(){ return this.toString().length; }
        toString(){ return !this.$a.length && this.$e !== null ? this.$e : this.$pre + this.$a.join(this.$sep) + this.$suf; }
      }
      // ── Integer, Long, Double, Float, Short, Byte, Boolean, Character (static) ──
      const nfe = s => new EX.NumberFormatException('«' + (s == null ? 'null' : s) + '» — не число');
      function parseIntJ(s, radix, min, max, big){
        if (s == null) throw new EX.NumberFormatException('null вместо числа');
        radix = radix || 10;
        const t = String(s);
        const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, radix);
        if (!t.length || !new RegExp('^[+-]?[' + digits + digits.toUpperCase() + ']+$').test(t)) throw nfe(t);
        let v = 0n; const neg = t[0] === '-';
        for (const ch of t.replace(/^[+-]/, '')) v = v * BigInt(radix) + BigInt(parseInt(ch, radix));
        if (neg) v = -v;
        if (v < min || v > max) throw new EX.NumberFormatException('«' + t + '» — слишком большое число для ' + (big ? 'long' : 'int'));
        return big ? v : Number(v);
      }
      const unsigned = (v, bits, radix) => (bits === 64 ? BigInt.asUintN(64, BigInt(v)) : (v | 0) >>> 0).toString(radix);
      const Integer = { MAX_VALUE: 2147483647, MIN_VALUE: -2147483648, SIZE: 32, BYTES: 4,
        parseInt: (s, r) => parseIntJ(s, r, -2147483648n, 2147483647n, false), valueOf: (s, r) => typeof s === 'string' ? Integer.parseInt(s, r) : s, decode: s => Integer.parseInt(String(s).replace(/^0x/i, ''), /^0x/i.test(s) ? 16 : 10),
        toString: (v, r) => r ? (v | 0).toString(r) : String(v), toBinaryString: v => unsigned(v, 32, 2), toHexString: v => unsigned(v, 32, 16), toOctalString: v => unsigned(v, 32, 8),
        compare: (a, b) => a < b ? -1 : a > b ? 1 : 0, max: Math.max, min: Math.min, sum: (a, b) => (a + b) | 0, signum: v => v > 0 ? 1 : v < 0 ? -1 : 0,
        bitCount: v => { v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24); },
        reverse: v => { let r = 0; for (let i = 0; i < 32; i++) { r = (r << 1) | (v & 1); v >>>= 1; } return r | 0; },
        highestOneBit: v => v === 0 ? 0 : (1 << (31 - Math.clz32(v))) | 0, lowestOneBit: v => (v & -v) | 0, numberOfLeadingZeros: v => Math.clz32(v), numberOfTrailingZeros: v => v === 0 ? 32 : 31 - Math.clz32(v & -v),
        hashCode: v => v | 0, parseUnsignedInt: s => parseIntJ(s, 10, 0n, 4294967295n, false) | 0, toUnsignedString: v => String(v >>> 0), divideUnsigned: (a, b) => ((a >>> 0) / (b >>> 0)) | 0, remainderUnsigned: (a, b) => ((a >>> 0) % (b >>> 0)) | 0 };
      const Long = { MAX_VALUE: 9223372036854775807n, MIN_VALUE: -9223372036854775808n, SIZE: 64, BYTES: 8,
        parseLong: (s, r) => parseIntJ(s, r, -9223372036854775808n, 9223372036854775807n, true), valueOf: s => typeof s === 'string' ? Long.parseLong(s) : BigInt(s),
        toString: (v, r) => BigInt(v).toString(r || 10), toBinaryString: v => unsigned(v, 64, 2), toHexString: v => unsigned(v, 64, 16), toOctalString: v => unsigned(v, 64, 8),
        compare: (a, b) => a < b ? -1 : a > b ? 1 : 0, max: (a, b) => a > b ? a : b, min: (a, b) => a < b ? a : b, sum: (a, b) => BigInt.asIntN(64, a + b), signum: v => v > 0n ? 1 : v < 0n ? -1 : 0,
        bitCount: v => { let n = 0, x = BigInt.asUintN(64, v); while (x) { n += Number(x & 1n); x >>= 1n; } return n; }, hashCode: v => hcAny(BigInt(v)), abs: v => v < 0n ? -v : v,
        numberOfTrailingZeros: v => { let x = BigInt.asUintN(64, v); if (!x) return 64; let n = 0; while (!(x & 1n)) { x >>= 1n; n++; } return n; },
        numberOfLeadingZeros: v => { let x = BigInt.asUintN(64, v); let n = 64; while (x) { x >>= 1n; n--; } return n; } };
      const parseD = s => { if (s == null) throw new EX.NullPointerException('parseDouble(null)'); const t = String(s).trim(); if (!/^[+-]?(NaN|Infinity|(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)[fFdD]?)$/.test(t)) throw nfe(s); return parseFloat(t.replace(/[fFdD]$/, '')); };
      const Double = { MAX_VALUE: Number.MAX_VALUE, MIN_VALUE: 5e-324, MIN_NORMAL: 2.2250738585072014e-308, POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity, NaN: NaN,
        parseDouble: parseD, valueOf: s => typeof s === 'string' ? parseD(s) : Number(s), toString: v => dstr(v), compare: (a, b) => cmpAny(a, b), isNaN: v => v !== v,
        isInfinite: v => v === Infinity || v === -Infinity, isFinite: v => Number.isFinite(v), max: Math.max, min: Math.min, sum: (a, b) => a + b, hashCode: v => dblHash(v) };
      const Float = { MAX_VALUE: 3.4028234663852886e38, MIN_VALUE: 1.401298464324817e-45, POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity, NaN: NaN,
        parseFloat: s => Math.fround(parseD(s)), valueOf: s => typeof s === 'string' ? Math.fround(parseD(s)) : Math.fround(s), toString: v => fstr(v), compare: (a, b) => cmpAny(a, b),
        isNaN: v => v !== v, isInfinite: v => v === Infinity || v === -Infinity, isFinite: v => Number.isFinite(v), max: (a, b) => Math.fround(Math.max(a, b)), min: (a, b) => Math.fround(Math.min(a, b)), sum: (a, b) => Math.fround(a + b) };
      const Short = { MAX_VALUE: 32767, MIN_VALUE: -32768, parseShort: s => parseIntJ(s, 10, -32768n, 32767n, false), valueOf: s => typeof s === 'string' ? Short.parseShort(s) : s, toString: v => String(v), compare: (a, b) => a - b };
      const Byte = { MAX_VALUE: 127, MIN_VALUE: -128, parseByte: s => parseIntJ(s, 10, -128n, 127n, false), valueOf: s => typeof s === 'string' ? Byte.parseByte(s) : s, toString: v => String(v), compare: (a, b) => a - b };
      const Bool = { TRUE: true, FALSE: false, parseBoolean: s => s != null && String(s).toLowerCase() === 'true', valueOf: s => typeof s === 'string' ? Bool.parseBoolean(s) : !!s, toString: v => String(!!v),
        compare: (a, b) => (a ? 1 : 0) - (b ? 1 : 0), logicalAnd: (a, b) => a && b, logicalOr: (a, b) => a || b, logicalXor: (a, b) => a !== b, hashCode: v => v ? 1231 : 1237 };
      const cc = (c, name) => { if (c == null) throw npe(name); return typeof c === 'number' ? String.fromCodePoint(c) : c; };
      const Character = { MIN_VALUE: CH(0), MAX_VALUE: CH(0xFFFF),
        isDigit: c => /^\p{Nd}$/u.test(cc(c, 'isDigit')), isLetter: c => /^\p{L}$/u.test(cc(c, 'isLetter')), isLetterOrDigit: c => /^[\p{L}\p{Nd}]$/u.test(cc(c, 'isLetterOrDigit')),
        isAlphabetic: c => /^\p{Alphabetic}$/u.test(cc(c, 'isAlphabetic')), isUpperCase: c => /^\p{Lu}$/u.test(cc(c, 'isUpperCase')), isLowerCase: c => /^\p{Ll}$/u.test(cc(c, 'isLowerCase')),
        isWhitespace: c => /^[\t\n\u000B\f\r\u001C-\u001F ]$|^[\p{Zs}\p{Zl}\p{Zp}]$/u.test(cc(c, 'isWhitespace')) && !/^[   ]$/.test(cc(c)), isSpaceChar: c => /^[\p{Zs}\p{Zl}\p{Zp}]$/u.test(cc(c, 'isSpaceChar')),
        toUpperCase: c => typeof c === 'number' ? cc(c).toUpperCase().codePointAt(0) : (cc(c, 'toUpperCase').toUpperCase().length === 1 ? c.toUpperCase() : c), toLowerCase: c => typeof c === 'number' ? cc(c).toLowerCase().codePointAt(0) : (cc(c, 'toLowerCase').toLowerCase().length === 1 ? c.toLowerCase() : c),
        getNumericValue: c => { c = cc(c, 'getNumericValue'); if (/^\d$/.test(c)) return +c; const i = parseInt(c, 36); return isNaN(i) ? -1 : i; },
        digit: (c, r) => { const i = parseInt(cc(c, 'digit'), r); return isNaN(i) ? -1 : i; }, forDigit: (d, r) => d >= 0 && d < r ? d.toString(r) : CH(0),
        valueOf: c => c, toString: c => cc(c, 'toString'), compare: (a, b) => a.charCodeAt(0) - b.charCodeAt(0), isDefined: () => true, toChars: cp => { const a = String.fromCodePoint(cp).split(''); a.$jt = 'C'; return a; },
        hashCode: c => c.charCodeAt(0), isValidCodePoint: cp => cp >= 0 && cp <= 0x10FFFF, isSurrogate: c => { const k = cc(c).charCodeAt(0); return k >= 0xD800 && k <= 0xDFFF; }, isHighSurrogate: c => { const k = cc(c).charCodeAt(0); return k >= 0xD800 && k <= 0xDBFF; },
        isLowSurrogate: c => { const k = cc(c).charCodeAt(0); return k >= 0xDC00 && k <= 0xDFFF; }, charCount: cp => cp >= 0x10000 ? 2 : 1, isISOControl: c => { const k = cc(c).charCodeAt(0); return k <= 0x1F || (k >= 0x7F && k <= 0x9F); },
        isJavaIdentifierStart: c => /^[\p{L}\p{Nl}\p{Sc}\p{Pc}]$/u.test(cc(c)), isJavaIdentifierPart: c => /^[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Nd}\p{Mn}\p{Mc}]$/u.test(cc(c)), isTitleCase: c => /^\p{Lt}$/u.test(cc(c)), isEmoji: cp => /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp)) };
      // ── коллекции ──
      const fnOf = (f, name) => f == null ? null : typeof f === 'function' ? f : (...a) => f[name](...a);
      const cmpOf = c => c == null ? cmpAny : typeof c === 'function' ? c : (a, b) => c.compare(a, b);
      const iter = src => ({ [Symbol.iterator]: src });
      class JIter extends JObject {   // Iterator Java поверх итератора JS (remove — через функцию коллекции)
        constructor(jsIt, rm){ super(); this.$it = jsIt; this.$rm = rm; this.$buf = null; this.$last = undefined; this.$can = false; }
        hasNext(){ if (!this.$buf) this.$buf = this.$it.next(); return !this.$buf.done; }
        next(){ if (!this.hasNext()) throw nse(); const v = this.$buf.value; this.$buf = null; this.$last = v; this.$can = true; return v; }
        remove(){ if (!this.$can || !this.$rm) throw new EX.IllegalStateException('iterator.remove() — только после next()'); this.$can = false; this.$rm(this.$last); }
        forEachRemaining(f){ f = fnOf(f, 'accept'); while (this.hasNext()) f(this.next()); }
        [Symbol.iterator](){ return { next: () => this.hasNext() ? { value: this.next(), done: false } : { value: undefined, done: true } }; }
      }
      class JColl extends JObject {
        isEmpty(){ return this.size() === 0; }
        contains(x){ for (const y of this) if (jeq(x, y)) return true; return false; }
        containsAll(c){ for (const x of it(c)) if (!this.contains(x)) return false; return true; }
        addAll(c){ if (c == null) throw npe('addAll'); let ch = false; for (const x of [...it(c)]) if (this.add(x) !== false) ch = true; return ch; }
        removeAll(c){ const o = [...it(c)]; return this.removeIf(x => o.some(y => jeq(x, y))); }
        retainAll(c){ const o = [...it(c)]; return this.removeIf(x => !o.some(y => jeq(x, y))); }
        removeIf(p){ p = fnOf(p, 'test'); const I = this.iterator(); let ch = false; while (I.hasNext()) if (p(I.next())) { I.remove(); ch = true; } return ch; }
        stream(){ return JStream.ofIt(this, this.$k); }
        parallelStream(){ return this.stream(); }
        forEach(f){ f = fnOf(f, 'accept'); for (const x of this) f(x); }
        toArray(){ return [...this]; }
        toString(){ return '[' + [...this].map(x => x === this ? '(this Collection)' : jstr(x, this.$k)).join(', ') + ']'; }
        iterator(){ return new JIter(this[Symbol.iterator](), x => this.remove(x)); }
        clear(){ const I = this.iterator(); while (I.hasNext()) { I.next(); I.remove(); } }
        hashCode(){ let h = 0; for (const x of this) h = (h + hcAny(x)) | 0; return h; }
        equals(o){ if (o === this) return true; if (!(o instanceof JColl) || o.size() !== this.size()) return false; for (const x of o) if (!this.contains(x)) return false; return true; }
      }
      class ListIter extends JObject {
        constructor(l, i){ super(); this.l = l; this.i = i | 0; this.last = -1; this.mc = l.$mc; if (this.i < 0 || this.i > l.$a.length) throw ioobe(i, l.$a.length); }
        chk(){ if (this.l.$mc !== this.mc) throw cme(); }
        hasNext(){ return this.i < this.l.$a.length; }
        next(){ this.chk(); if (this.i >= this.l.$a.length) throw nse(); this.last = this.i; return this.l.$a[this.i++]; }
        hasPrevious(){ return this.i > 0; }
        previous(){ this.chk(); if (this.i <= 0) throw nse(); this.last = --this.i; return this.l.$a[this.i]; }
        nextIndex(){ return this.i; } previousIndex(){ return this.i - 1; }
        remove(){ if (this.last < 0) throw new EX.IllegalStateException('iterator.remove() — только после next()'); this.chk(); this.l.removeAt(this.last); if (this.last < this.i) this.i--; this.last = -1; this.mc = this.l.$mc; }
        set(x){ if (this.last < 0) throw new EX.IllegalStateException('set() — только после next()'); this.l.set(this.last, x); }
        add(x){ this.chk(); this.l.add(this.i++, x); this.last = -1; this.mc = this.l.$mc; }
        forEachRemaining(f){ f = fnOf(f, 'accept'); while (this.hasNext()) f(this.next()); }
        [Symbol.iterator](){ return { next: () => this.hasNext() ? { value: this.next(), done: false } : { value: undefined, done: true } }; }
      }
      class ArrayList extends JColl {
        constructor(x){ super(); this.$a = []; this.$mc = 0; if (x != null && typeof x === 'object') { for (const v of it(x)) this.$a.push(v); if (x.$k) this.$k = x.$k; } else if (typeof x === 'number' && x < 0) throw new EX.IllegalArgumentException('ёмкость меньше нуля: ' + x); }
        static wrap(a, ro){ const l = new ArrayList(); l.$a = a; if (ro) l.$ro = ro; return l; }
        $w(){ if (this.$ro) throw uoe(this.$ro === 'F' ? 'у списка из Arrays.asList размер не меняется (сделай new ArrayList<>(Arrays.asList(…)))' : null); }
        size(){ return this.$a.length; }
        get(i){ if (!(i >>> 0 < this.$a.length)) throw ioobe(i, this.$a.length); return this.$a[i]; }
        set(i, x){ if (this.$ro === 1) throw uoe(); if (!(i >>> 0 < this.$a.length)) throw ioobe(i, this.$a.length); const o = this.$a[i]; this.$a[i] = x; return o; }
        add(a, b){ this.$w(); if (arguments.length < 2) { this.$a.push(a); this.$mc++; return true; } if (!(a >= 0 && a <= this.$a.length)) throw ioobe(a, this.$a.length); this.$a.splice(a, 0, b); this.$mc++; }
        removeAt(i){ this.$w(); if (!(i >>> 0 < this.$a.length)) throw ioobe(i, this.$a.length); this.$mc++; return this.$a.splice(i, 1)[0]; }
        remove(x){ if (typeof x === 'number' && arguments.length === 1 && this.$rmIdx) return this.removeAt(x); this.$w(); const i = this.indexOf(x); if (i < 0) return false; this.$a.splice(i, 1); this.$mc++; return true; }
        indexOf(x){ for (let i = 0; i < this.$a.length; i++) if (jeq(x, this.$a[i])) return i; return -1; }
        lastIndexOf(x){ for (let i = this.$a.length - 1; i >= 0; i--) if (jeq(x, this.$a[i])) return i; return -1; }
        contains(x){ return this.indexOf(x) >= 0; }
        clear(){ this.$w(); this.$a.length = 0; this.$mc++; }
        addAll(a, b){ this.$w(); if (b === undefined) { if (a == null) throw npe('addAll'); const xs = [...it(a)]; for (const x of xs) this.$a.push(x); this.$mc++; return xs.length > 0; } const xs = [...it(b)]; this.$a.splice(a, 0, ...xs); this.$mc++; return xs.length > 0; }
        removeIf(p){ this.$w(); p = fnOf(p, 'test'); const n = this.$a.length, keep = this.$a.filter(x => !p(x)); if (keep.length === n) return false; this.$a.length = 0; this.$a.push(...keep); this.$mc++; return true; }
        sort(c){ if (this.$ro === 1) throw uoe(); const f = cmpOf(c); this.$a.sort((a, b) => f(a, b)); this.$mc++; }
        replaceAll(f){ if (this.$ro === 1) throw uoe(); f = fnOf(f, 'apply'); for (let i = 0; i < this.$a.length; i++) this.$a[i] = f(this.$a[i]); }
        subList(a, b){ if (a < 0 || b > this.$a.length || a > b) throw ioobe(a < 0 ? a : b, this.$a.length); return new SubList(this, a, b); }
        iterator(){ return new ListIter(this, 0); }
        listIterator(i){ return new ListIter(this, i || 0); }
        *[Symbol.iterator](){ const mc = this.$mc; let i = 0; while (i !== this.$a.length) { if (this.$mc !== mc) throw cme(); yield this.$a[i++]; } }
        forEach(f){ f = fnOf(f, 'accept'); const mc = this.$mc; for (let i = 0; i < this.$a.length; i++) { f(this.$a[i]); if (this.$mc !== mc) throw cme(); } }
        getFirst(){ if (!this.$a.length) throw nse('список пуст'); return this.$a[0]; }
        getLast(){ if (!this.$a.length) throw nse('список пуст'); return this.$a[this.$a.length - 1]; }
        removeFirst(){ if (!this.$a.length) throw nse('список пуст'); return this.removeAt(0); }
        removeLast(){ if (!this.$a.length) throw nse('список пуст'); return this.removeAt(this.$a.length - 1); }
        addFirst(x){ this.add(0, x); } addLast(x){ this.add(x); }
        reversed(){ const l = new ArrayList(); l.$a = this.$a.slice().reverse(); l.$k = this.$k; return l; }
        equals(o){ if (o === this) return true; if (!(o instanceof JColl) || !o.$list) return false; const b = [...o]; return b.length === this.$a.length && this.$a.every((x, i) => jeq(x, b[i])); }
        hashCode(){ let h = 1; for (const x of this.$a) h = (Math.imul(31, h) + hcAny(x)) | 0; return h; }
        toArray(){ return this.$a.slice(); }
        stream(){ return JStream.ofIt(this.$a, this.$k); }
        ensureCapacity(){} trimToSize(){}
        clone(){ return new ArrayList(this); }
      }
      ArrayList.prototype.$list = true;
      class SubList extends ArrayList {
        constructor(p, a, b){ super(); this.$p = p; this.$o = a; this.$n = b - a; this.$mc = p.$mc; Object.defineProperty(this, '$a', { get: () => p.$a.slice(this.$o, this.$o + this.$n), set(){}, configurable: true }); }
        size(){ return this.$n; }
        get(i){ if (!(i >>> 0 < this.$n)) throw ioobe(i, this.$n); return this.$p.$a[this.$o + i]; }
        set(i, x){ if (!(i >>> 0 < this.$n)) throw ioobe(i, this.$n); return this.$p.set(this.$o + i, x); }
        add(a, b){ if (arguments.length < 2) { this.$p.add(this.$o + this.$n, a); this.$n++; return true; } this.$p.add(this.$o + a, b); this.$n++; }
        removeAt(i){ if (!(i >>> 0 < this.$n)) throw ioobe(i, this.$n); this.$n--; return this.$p.removeAt(this.$o + i); }
        remove(x){ const i = this.indexOf(x); if (i < 0) return false; this.removeAt(i); return true; }
        clear(){ for (let i = this.$n - 1; i >= 0; i--) this.$p.removeAt(this.$o + i); this.$n = 0; }
        sort(c){ const xs = this.$a, f = cmpOf(c); xs.sort((a, b) => f(a, b)); xs.forEach((x, i) => { this.$p.$a[this.$o + i] = x; }); }
        *[Symbol.iterator](){ for (let i = 0; i < this.$n; i++) yield this.$p.$a[this.$o + i]; }
        iterator(){ const self = this; let i = 0, last = -1; return Object.assign(new JIter({ next: () => i < self.$n ? { value: (last = i, self.$p.$a[self.$o + i++]), done: false } : { done: true } }, () => { self.removeAt(last); i--; })); }
      }
      class LinkedList extends ArrayList {
        offer(x){ return this.add(x); } offerFirst(x){ this.add(0, x); return true; } offerLast(x){ return this.add(x); }
        poll(){ return this.$a.length ? this.removeAt(0) : null; } pollFirst(){ return this.poll(); } pollLast(){ return this.$a.length ? this.removeAt(this.$a.length - 1) : null; }
        peek(){ return this.$a.length ? this.$a[0] : null; } peekFirst(){ return this.peek(); } peekLast(){ return this.$a.length ? this.$a[this.$a.length - 1] : null; }
        element(){ return this.getFirst(); } push(x){ this.add(0, x); } pop(){ return this.removeFirst(); } removeHead(){ return this.removeFirst(); }
        descendingIterator(){ return new JIter(this.$a.slice().reverse()[Symbol.iterator](), x => this.remove(x)); }
        removeFirstOccurrence(x){ return this.remove(x); } removeLastOccurrence(x){ const i = this.lastIndexOf(x); if (i < 0) return false; this.removeAt(i); return true; }
      }
      class Stack extends ArrayList {
        push(x){ this.add(x); return x; }
        pop(){ if (!this.$a.length) throw new EX.EmptyStackException('стек пуст'); return this.removeAt(this.$a.length - 1); }
        peek(){ if (!this.$a.length) throw new EX.EmptyStackException('стек пуст'); return this.$a[this.$a.length - 1]; }
        empty(){ return !this.$a.length; }
        search(o){ const i = this.lastIndexOf(o); return i < 0 ? -1 : this.$a.length - i; }
      }
      class ArrayDeque extends JColl {
        constructor(x){ super(); this.$a = []; this.$mc = 0; if (x != null && typeof x === 'object') for (const v of it(x)) this.addLast(v); }
        $nn(x){ if (x == null) throw new EX.NullPointerException('в ArrayDeque нельзя класть null'); return x; }
        size(){ return this.$a.length; }
        addFirst(x){ this.$a.unshift(this.$nn(x)); this.$mc++; } addLast(x){ this.$a.push(this.$nn(x)); this.$mc++; }
        offerFirst(x){ this.addFirst(x); return true; } offerLast(x){ this.addLast(x); return true; }
        add(x){ this.addLast(x); return true; } offer(x){ this.addLast(x); return true; } push(x){ this.addFirst(x); }
        pollFirst(){ if (!this.$a.length) return null; this.$mc++; return this.$a.shift(); } pollLast(){ if (!this.$a.length) return null; this.$mc++; return this.$a.pop(); }
        poll(){ return this.pollFirst(); }
        removeFirst(){ if (!this.$a.length) throw nse('очередь пуста'); return this.pollFirst(); } removeLast(){ if (!this.$a.length) throw nse('очередь пуста'); return this.pollLast(); }
        pop(){ return this.removeFirst(); } removeHead(){ return this.removeFirst(); } element(){ return this.getFirst(); }
        peekFirst(){ return this.$a.length ? this.$a[0] : null; } peekLast(){ return this.$a.length ? this.$a[this.$a.length - 1] : null; } peek(){ return this.peekFirst(); }
        getFirst(){ if (!this.$a.length) throw nse('очередь пуста'); return this.$a[0]; } getLast(){ if (!this.$a.length) throw nse('очередь пуста'); return this.$a[this.$a.length - 1]; }
        remove(x){ const i = this.$a.findIndex(y => jeq(x, y)); if (i < 0) return false; this.$a.splice(i, 1); this.$mc++; return true; }
        removeFirstOccurrence(x){ return this.remove(x); } removeLastOccurrence(x){ for (let i = this.$a.length - 1; i >= 0; i--) if (jeq(x, this.$a[i])) { this.$a.splice(i, 1); this.$mc++; return true; } return false; }
        clear(){ this.$a.length = 0; this.$mc++; }
        *[Symbol.iterator](){ const mc = this.$mc; for (let i = 0; i < this.$a.length; i++) { if (this.$mc !== mc) throw cme(); yield this.$a[i]; } }
        iterator(){ const self = this; let i = 0, mc = this.$mc; return new JIter({ next: () => { if (self.$mc !== mc) throw cme(); return i < self.$a.length ? { value: self.$a[i++], done: false } : { done: true }; } }, () => { self.$a.splice(--i, 1); self.$mc++; mc = self.$mc; }); }
        descendingIterator(){ return new JIter(this.$a.slice().reverse()[Symbol.iterator](), x => this.removeLastOccurrence(x)); }
        clone(){ return new ArrayDeque(this); }
        reversed(){ const d = new ArrayDeque(); d.$a = this.$a.slice().reverse(); return d; }
      }
      class PriorityQueue extends JColl {   // двоичная куча как в Java: печать — в порядке массива кучи
        constructor(a, b){
          super(); this.$q = []; this.$c = null; this.$mc = 0;
          if (typeof a === 'number') { if (a < 1) throw new EX.IllegalArgumentException('ёмкость < 1'); this.$c = b ? cmpOf(b) : null; this.$cc = b || null; }
          else if (a != null && (typeof a === 'function' || typeof a.compare === 'function')) { this.$c = cmpOf(a); this.$cc = a; }
          else if (a != null && typeof a === 'object') { if (a instanceof PriorityQueue) { this.$c = a.$c; this.$cc = a.$cc; } for (const x of it(a)) { if (x == null) throw npe('PriorityQueue'); this.$q.push(x); } for (let i = (this.$q.length >>> 1) - 1; i >= 0; i--) this.$down(i, this.$q[i]); }
        }
        $cmp(x, y){ return this.$c ? this.$c(x, y) : cmpAny(x, y); }
        $up(k, x){ const q = this.$q; while (k > 0) { const p = (k - 1) >>> 1, e = q[p]; if (this.$cmp(x, e) >= 0) break; q[k] = e; k = p; } q[k] = x; }
        $down(k, x){ const q = this.$q, n = q.length, half = n >>> 1; while (k < half) { let c = (k << 1) + 1, cv = q[c]; const r = c + 1; if (r < n && this.$cmp(cv, q[r]) > 0) cv = q[c = r]; if (this.$cmp(x, cv) <= 0) break; q[k] = cv; k = c; } q[k] = x; }
        offer(x){ if (x == null) throw npe('offer'); this.$q.push(x); this.$up(this.$q.length - 1, x); this.$mc++; return true; }
        add(x){ return this.offer(x); }
        poll(){ const q = this.$q; if (!q.length) return null; const r = q[0], x = q.pop(); if (q.length) this.$down(0, x); this.$mc++; return r; }
        peek(){ return this.$q.length ? this.$q[0] : null; }
        element(){ if (!this.$q.length) throw nse('очередь пуста'); return this.$q[0]; }
        removeHead(){ if (!this.$q.length) throw nse('очередь пуста'); return this.poll(); }
        $removeAt(i){ const q = this.$q, s = q.length - 1; this.$mc++; if (s === i) { q.pop(); return; } const moved = q.pop(); this.$down(i, moved); if (q[i] === moved) this.$up(i, moved); }
        remove(x){ const i = this.$q.findIndex(y => jeq(x, y)); if (i < 0) return false; this.$removeAt(i); return true; }
        size(){ return this.$q.length; }
        clear(){ this.$q.length = 0; this.$mc++; }
        comparator(){ return this.$cc || null; }
        *[Symbol.iterator](){ const mc = this.$mc; for (let i = 0; i < this.$q.length; i++) { if (this.$mc !== mc) throw cme(); yield this.$q[i]; } }
        iterator(){ const self = this; let i = 0, last = -1, mc = this.$mc; return new JIter({ next: () => { if (self.$mc !== mc) throw cme(); return i < self.$q.length ? { value: self.$q[last = i++], done: false } : { done: true }; } }, () => { self.$removeAt(last); i--; mc = self.$mc; }); }
      }
      // ── Map: HashMap в порядке Java (по корзинам хеша), LinkedHashMap — по добавлению, TreeMap — по ключам ──
      const customEq = k => k !== null && typeof k === 'object' && typeof k.equals === 'function' && k.equals !== JObject.prototype.equals && !(k instanceof JEnum);
      const tableSize = n => { let c = 1; while (c < n) c *= 2; return Math.max(1, c); };
      const sp = h => (h ^ (h >>> 16));
      class MapEntry extends JObject {
        constructor(e, m, ro){ super(); this.$e = e; this.$m = m; this.$ro = ro; }
        getKey(){ return this.$e.k; } getValue(){ return this.$e.v; }
        setValue(v){ if (this.$ro) throw uoe(); const o = this.$e.v; this.$e.v = v; return o; }
        equals(o){ return o instanceof MapEntry && jeq(this.getKey(), o.getKey()) && jeq(this.getValue(), o.getValue()); }
        hashCode(){ return hcAny(this.$e.k) ^ hcAny(this.$e.v); }
        toString(){ return jstr(this.$e.k, this.$m && this.$m.$k) + '=' + jstr(this.$e.v, this.$m && this.$m.$kv); }
      }
      class AbstractMapJ extends JObject {
        isEmpty(){ return this.size() === 0; }
        getOrDefault(k, d){ const e = this.$find(k); return e ? e.v : d; }
        putIfAbsent(k, v){ const e = this.$find(k); if (e && e.v != null) return e.v; this.put(k, v); return null; }
        computeIfAbsent(k, f){ f = fnOf(f, 'apply'); const e = this.$find(k); if (e && e.v != null) return e.v; const v = f(k); if (v != null) this.put(k, v); return v; }
        computeIfPresent(k, f){ f = fnOf(f, 'apply'); const e = this.$find(k); if (!e || e.v == null) return null; const v = f(k, e.v); if (v == null) this.remove(k); else this.put(k, v); return v; }
        compute(k, f){ f = fnOf(f, 'apply'); const e = this.$find(k), o = e ? e.v : null; const v = f(k, o); if (v == null) { if (e) this.remove(k); } else this.put(k, v); return v; }
        merge(k, v, f){ if (v == null) throw npe('merge'); f = fnOf(f, 'apply'); const e = this.$find(k), o = e ? e.v : null; const n = o == null ? v : f(o, v); if (n == null) this.remove(k); else this.put(k, n); return n; }
        putAll(m){ if (m == null) throw npe('putAll'); for (const e of m.$entries()) this.put(e.k, e.v); }
        forEach(f){ f = fnOf(f, 'accept'); const mc = this.$mc; for (const e of this.$entries()) { f(e.k, e.v); if (this.$mc !== mc) throw cme(); } }
        replaceAll(f){ if (this.$ro) throw uoe(); f = fnOf(f, 'apply'); for (const e of this.$entries()) e.v = f(e.k, e.v); }
        replace(k, v){ const e = this.$find(k); if (!e) return null; const o = e.v; e.v = v; return o; }
        containsValue(v){ for (const e of this.$entries()) if (jeq(v, e.v)) return true; return false; }
        containsKey(k){ return !!this.$find(k); }
        get(k){ const e = this.$find(k); return e ? e.v : null; }
        keySet(){ return new MapView(this, 'k'); } values(){ return new MapView(this, 'v'); } entrySet(){ return new MapView(this, 'e'); }
        equals(o){ if (o === this) return true; if (!(o instanceof AbstractMapJ) || o.size() !== this.size()) return false; for (const e of this.$entries()) { const f = o.$find(e.k); if (!f || !jeq(e.v, f.v)) return false; } return true; }
        hashCode(){ let h = 0; for (const e of this.$entries()) h = (h + (hcAny(e.k) ^ hcAny(e.v))) | 0; return h; }
        toString(){ return '{' + this.$entries().map(e => (e.k === this ? '(this Map)' : jstr(e.k, this.$k)) + '=' + (e.v === this ? '(this Map)' : jstr(e.v, this.$kv))).join(', ') + '}'; }
        $ent(e){ return new MapEntry(e, this, false); }
      }
      class HashMap extends AbstractMapJ {
        constructor(a, lf, ao){
          super(); this.$m = new Map(); this.$b = null; this.$all = new Set(); this.$seq = 0; this.$cap = 16; this.$ord = null; this.$mc = 0; this.$ao = !!ao;
          if (typeof a === 'number') { if (a < 0) throw new EX.IllegalArgumentException('ёмкость < 0'); this.$cap = tableSize(a); }
          else if (a instanceof AbstractMapJ) { this.$cap = Math.max(16, tableSize(Math.ceil(a.size() / 0.75))); this.putAll(a); this.$k = a.$k; this.$kv = a.$kv; }
        }
        $find(k){
          if (customEq(k)) { const L = this.$b && this.$b.get(hcAny(k)); if (L) for (const e of L) if (jeq(k, e.k)) return e; return null; }
          return this.$m.get(k) || null;
        }
        get(k){ const e = this.$find(k); if (e && this.$ao) this.$touch(e); return e ? e.v : null; }
        put(k, v){
          if (this.$ro) throw uoe();
          const e = this.$find(k);
          if (e) { const o = e.v; e.v = v; if (this.$ao) this.$touch(e); return o; }
          const n = { k, v, seq: ++this.$seq, h: hcAny(k) };
          if (customEq(k)) { if (!this.$b) this.$b = new Map(); let L = this.$b.get(n.h); if (!L) this.$b.set(n.h, L = []); L.push(n); } else this.$m.set(k, n);
          this.$all.add(n); this.$ord = null; this.$mc++;
          while (this.$all.size > this.$cap * 0.75) this.$cap *= 2;
          if (typeof this.removeEldestEntry === 'function' && this.$all.size) { const eld = this.$entries()[0]; if (this.removeEldestEntry(this.$ent(eld))) this.$del(eld); }
          return null;
        }
        $touch(e){ this.$all.delete(e); e.seq = ++this.$seq; this.$all.add(e); this.$ord = null; }
        $del(e){ this.$all.delete(e); if (customEq(e.k)) { const L = this.$b.get(e.h); if (L) { L.splice(L.indexOf(e), 1); if (!L.length) this.$b.delete(e.h); } } else this.$m.delete(e.k); this.$ord = null; this.$mc++; }
        remove(k){ if (this.$ro) throw uoe(); const e = this.$find(k); if (!e) return null; this.$del(e); return e.v; }
        size(){ return this.$all.size; }
        clear(){ if (this.$ro) throw uoe(); this.$all.clear(); this.$m.clear(); this.$b = null; this.$ord = null; this.$mc++; }
        $entries(){ if (!this.$ord) { const cap = this.$cap; this.$ord = this.$linked ? [...this.$all] : [...this.$all].sort((a, b) => ((sp(a.h) & (cap - 1)) - (sp(b.h) & (cap - 1))) || (a.seq - b.seq)); } return this.$ord; }
        clone(){ return new this.constructor(this); }
      }
      class LinkedHashMap extends HashMap {
        constructor(a, lf, ao){ super(a, lf, ao); this.$linked = true; }
        firstEntry(){ const e = this.$entries()[0]; return e ? new MapEntry(e, this, true) : null; }
        lastEntry(){ const a = this.$entries(); return a.length ? new MapEntry(a[a.length - 1], this, true) : null; }
        pollFirstEntry(){ const e = this.$entries()[0]; if (!e) return null; this.$del(e); return new MapEntry(e, this, true); }
        pollLastEntry(){ const a = this.$entries(); if (!a.length) return null; const e = a[a.length - 1]; this.$del(e); return new MapEntry(e, this, true); }
      }
      class TreeMap extends AbstractMapJ {
        constructor(a){ super(); this.$e = []; this.$c = null; this.$cc = null; this.$mc = 0;
          if (a != null && (typeof a === 'function' || (typeof a === 'object' && typeof a.compare === 'function'))) { this.$c = cmpOf(a); this.$cc = a; }
          else if (a instanceof AbstractMapJ) { if (a instanceof TreeMap) { this.$c = a.$c; this.$cc = a.$cc; } this.putAll(a); this.$k = a.$k; this.$kv = a.$kv; } }
        $cmp(a, b){ return this.$c ? this.$c(a, b) : cmpAny(a, b); }
        $idx(k){ if (k == null && !this.$c) throw npe('TreeMap: ключ null'); let lo = 0, hi = this.$e.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1, c = this.$cmp(this.$e[m].k, k); if (c < 0) lo = m + 1; else if (c > 0) hi = m - 1; else return m; } return -(lo + 1); }
        $find(k){ const i = this.$idx(k); return i >= 0 ? this.$e[i] : null; }
        put(k, v){ if (this.$ro) throw uoe(); const i = this.$idx(k); if (i >= 0) { const o = this.$e[i].v; this.$e[i].v = v; return o; } this.$e.splice(-i - 1, 0, { k, v }); this.$mc++; return null; }
        remove(k){ if (this.$ro) throw uoe(); const i = this.$idx(k); if (i < 0) return null; this.$mc++; return this.$e.splice(i, 1)[0].v; }
        $del(e){ const i = this.$e.indexOf(e); if (i >= 0) { this.$e.splice(i, 1); this.$mc++; } }
        size(){ return this.$e.length; }
        clear(){ this.$e.length = 0; this.$mc++; }
        $entries(){ return this.$e.slice(); }
        $at(i){ return i >= 0 && i < this.$e.length ? this.$e[i] : null; }
        $near(k, mode){ const i = this.$idx(k); const ins = i >= 0 ? i : -i - 1; switch (mode) { case 'floor': return i >= 0 ? this.$e[i] : this.$at(ins - 1); case 'ceiling': return i >= 0 ? this.$e[i] : this.$at(ins); case 'higher': return this.$at(i >= 0 ? i + 1 : ins); case 'lower': return this.$at(i >= 0 ? i - 1 : ins - 1); } return null; }
        firstKey(){ if (!this.$e.length) throw nse('карта пуста'); return this.$e[0].k; } lastKey(){ if (!this.$e.length) throw nse('карта пуста'); return this.$e[this.$e.length - 1].k; }
        floorKey(k){ const e = this.$near(k, 'floor'); return e ? e.k : null; } ceilingKey(k){ const e = this.$near(k, 'ceiling'); return e ? e.k : null; }
        higherKey(k){ const e = this.$near(k, 'higher'); return e ? e.k : null; } lowerKey(k){ const e = this.$near(k, 'lower'); return e ? e.k : null; }
        floorEntry(k){ const e = this.$near(k, 'floor'); return e ? new MapEntry(e, this, true) : null; } ceilingEntry(k){ const e = this.$near(k, 'ceiling'); return e ? new MapEntry(e, this, true) : null; }
        higherEntry(k){ const e = this.$near(k, 'higher'); return e ? new MapEntry(e, this, true) : null; } lowerEntry(k){ const e = this.$near(k, 'lower'); return e ? new MapEntry(e, this, true) : null; }
        firstEntry(){ return this.$e.length ? new MapEntry(this.$e[0], this, true) : null; } lastEntry(){ return this.$e.length ? new MapEntry(this.$e[this.$e.length - 1], this, true) : null; }
        pollFirstEntry(){ if (!this.$e.length) return null; this.$mc++; return new MapEntry(this.$e.shift(), this, true); } pollLastEntry(){ if (!this.$e.length) return null; this.$mc++; return new MapEntry(this.$e.pop(), this, true); }
        $sub(f){ const m = new TreeMap(this.$cc); m.$e = this.$e.filter(f).map(e => ({ k: e.k, v: e.v })); m.$k = this.$k; m.$kv = this.$kv; return m; }
        headMap(k, inc){ return this.$sub(e => { const c = this.$cmp(e.k, k); return c < 0 || (inc && c === 0); }); }
        tailMap(k, inc){ return this.$sub(e => { const c = this.$cmp(e.k, k); return c > 0 || (inc !== false && c === 0); }); }
        subMap(a, b, c, d){ const ai = typeof b === 'boolean' ? b : true, bk = typeof b === 'boolean' ? c : b, bi = typeof b === 'boolean' ? d : false; return this.$sub(e => { const x = this.$cmp(e.k, a), y = this.$cmp(e.k, bk); return (x > 0 || (ai && x === 0)) && (y < 0 || (bi && y === 0)); }); }
        descendingMap(){ const base = this.$c || cmpAny, m = new TreeMap((x, y) => base(y, x)); m.$e = this.$e.slice().reverse().map(e => ({ k: e.k, v: e.v })); return m; }
        navigableKeySet(){ return this.keySet(); } descendingKeySet(){ return new TreeSet(this.descendingMap().keySet()); }
        comparator(){ return this.$cc || null; }
        reversed(){ return this.descendingMap(); }
      }
      // keySet() / values() / entrySet() — «живые» виды карты (remove через них удаляет из карты)
      class MapView extends JColl {
        constructor(m, w){ super(); this.$mp = m; this.$wh = w; this.$k = w === 'v' ? m.$kv : w === 'k' ? m.$k : null; }
        size(){ return this.$mp.size(); }
        $val(e){ return this.$wh === 'k' ? e.k : this.$wh === 'v' ? e.v : this.$mp.$ent(e); }
        *[Symbol.iterator](){ const m = this.$mp, mc = m.$mc; for (const e of m.$entries()) { if (m.$mc !== mc) throw cme(); yield this.$val(e); } }
        iterator(){ const m = this.$mp, es = m.$entries(); let i = 0, mc = m.$mc, last = null; return new JIter({ next: () => { if (m.$mc !== mc) throw cme(); return i < es.length ? { value: this.$val(last = es[i++]), done: false } : { done: true }; } }, () => { if (m.$ro) throw uoe(); m.$del(last); mc = m.$mc; }); }
        contains(x){ if (this.$wh === 'k') return this.$mp.containsKey(x); if (this.$wh === 'v') return this.$mp.containsValue(x); return x instanceof MapEntry && this.$mp.containsKey(x.getKey()) && jeq(this.$mp.get(x.getKey()), x.getValue()); }
        remove(x){ if (this.$wh === 'k') { const had = this.$mp.containsKey(x); this.$mp.remove(x); return had; } for (const e of this.$mp.$entries()) if (this.$wh === 'v' ? jeq(x, e.v) : x instanceof MapEntry && jeq(x.getKey(), e.k)) { this.$mp.$del(e); return true; } return false; }
        add(){ throw uoe('в keySet()/values() нельзя добавлять — пиши map.put(ключ, значение)'); }
        clear(){ this.$mp.clear(); }
        toArray(){ return [...this]; }
        equals(o){ if (this.$wh === 'v') return o === this; return JColl.prototype.equals.call(this, o); }
      }
      class HashSet extends JColl {
        constructor(x){ super(); this.$h = this.$mkMap(); if (x != null && typeof x === 'object') { for (const v of it(x)) this.add(v); if (x.$k) this.$k = x.$k; } else if (typeof x === 'number') this.$h.$cap = tableSize(x); }
        $mkMap(){ return new HashMap(); }
        add(x){ if (this.$ro) throw uoe(); if (this.$h.$find(x)) return false; this.$h.put(x, true); return true; }
        remove(x){ if (this.$ro) throw uoe(); const e = this.$h.$find(x); if (!e) return false; this.$h.$del(e); return true; }
        contains(x){ return !!this.$h.$find(x); }
        size(){ return this.$h.size(); }
        clear(){ if (this.$ro) throw uoe(); this.$h.clear(); }
        get $mc(){ return this.$h.$mc; }
        *[Symbol.iterator](){ const m = this.$h, mc = m.$mc; for (const e of m.$entries()) { if (m.$mc !== mc) throw cme(); yield e.k; } }
        iterator(){ const v = new MapView(this.$h, 'k'); if (this.$ro) v.$mp = Object.assign(Object.create(this.$h), { $ro: true }); return v.iterator(); }
        clone(){ return new this.constructor(this); }
      }
      class LinkedHashSet extends HashSet {
        $mkMap(){ const m = new HashMap(); m.$linked = true; return m; }
        getFirst(){ const e = this.$h.$entries()[0]; if (!e) throw nse(); return e.k; } getLast(){ const a = this.$h.$entries(); if (!a.length) throw nse(); return a[a.length - 1].k; }
      }
      class TreeSet extends HashSet {
        constructor(x){ super(); if (x != null && (typeof x === 'function' || (typeof x === 'object' && typeof x.compare === 'function'))) this.$h = new TreeMap(x); else if (x != null && typeof x === 'object') { if (x instanceof TreeSet) this.$h = new TreeMap(x.$h.$cc); for (const v of it(x)) this.add(v); } }
        $mkMap(){ return new TreeMap(); }
        first(){ return this.$h.firstKey(); } last(){ return this.$h.lastKey(); }
        getFirst(){ return this.first(); } getLast(){ return this.last(); }
        floor(x){ return this.$h.floorKey(x); } ceiling(x){ return this.$h.ceilingKey(x); } higher(x){ return this.$h.higherKey(x); } lower(x){ return this.$h.lowerKey(x); }
        pollFirst(){ const e = this.$h.pollFirstEntry(); return e ? e.getKey() : null; } pollLast(){ const e = this.$h.pollLastEntry(); return e ? e.getKey() : null; }
        $from(m){ const s = new TreeSet(); s.$h = m; return s; }
        headSet(x, inc){ return this.$from(this.$h.headMap(x, inc)); } tailSet(x, inc){ return this.$from(this.$h.tailMap(x, inc)); }
        subSet(a, b, c, d){ return this.$from(this.$h.subMap(a, b, c, d)); }
        descendingSet(){ return this.$from(this.$h.descendingMap()); } descendingIterator(){ return this.descendingSet().iterator(); }
        comparator(){ return this.$h.$cc || null; }
      }
      const ordCmp = (a, b) => a.$ord - b.$ord;
      class EnumMap extends TreeMap { constructor(a){ super(ordCmp); if (a instanceof AbstractMapJ) this.putAll(a); } }
      class EnumSet extends TreeSet {
        constructor(){ super(ordCmp); }
        static $vals(c){ const C = c && c.$C ? c.$C : c; return (C && C.$values) || []; }
        static of(xs){ const s = new EnumSet(); for (const x of xs) s.add(x); return s; }
        static allOf(c){ return EnumSet.of(EnumSet.$vals(c)); } static noneOf(){ return new EnumSet(); }
        static range(a, b){ const all = a.constructor.$values || Object.getPrototypeOf(a.constructor).$values || []; return EnumSet.of(all.filter(x => x.$ord >= a.$ord && x.$ord <= b.$ord)); }
        static copyOf(c){ return EnumSet.of([...it(c)]); }
        static complementOf(s){ const any = s.size() ? s.first() : null; if (!any) return new EnumSet(); const all = any.constructor.$values || Object.getPrototypeOf(any.constructor).$values || []; return EnumSet.of(all.filter(x => !s.contains(x))); }
      }
      // неизменяемые: List.of, Set.of, Map.of, Collections.unmodifiable…
      const roList = (xs, k) => { for (const x of xs) if (x == null) throw new EX.NullPointerException('List.of: null нельзя'); const l = ArrayList.wrap(Array.from(xs), 1); if (k) l.$k = k; return l; };
      const roSet = xs => { const s = new HashSet(); for (const x of xs) { if (x == null) throw new EX.NullPointerException('Set.of: null нельзя'); if (!s.add(x)) throw new EX.IllegalArgumentException('Set.of: повтор ' + jstr(x)); } s.$ro = true; return s; };
      const roMap = m => { m.$ro = true; return m; };
      // ── Optional ──
      class Optional extends JObject {
        constructor(v){ super(); this.$v = v === undefined ? null : v; }
        static of(v){ if (v == null) throw new EX.NullPointerException('Optional.of(null) — для null пиши Optional.ofNullable'); return new Optional(v); }
        static ofNullable(v){ return v == null ? EMPTY_OPT : new Optional(v); }
        static empty(){ return EMPTY_OPT; }
        isPresent(){ return this.$v !== null; } isEmpty(){ return this.$v === null; }
        get(){ if (this.$v === null) throw nse('No value present (Optional пустой)'); return this.$v; }
        orElseThrow(s){ if (this.$v === null) { if (s) throw fnOf(s, 'get')(); throw nse('No value present (Optional пустой)'); } return this.$v; }
        orElse(d){ return this.$v !== null ? this.$v : d; }
        orElseGet(s){ return this.$v !== null ? this.$v : fnOf(s, 'get')(); }
        ifPresent(f){ if (this.$v !== null) fnOf(f, 'accept')(this.$v); }
        ifPresentOrElse(f, r){ if (this.$v !== null) fnOf(f, 'accept')(this.$v); else fnOf(r, 'run')(); }
        map(f){ return this.$v === null ? this : Optional.ofNullable(fnOf(f, 'apply')(this.$v)); }
        flatMap(f){ return this.$v === null ? this : fnOf(f, 'apply')(this.$v); }
        filter(p){ return this.$v !== null && fnOf(p, 'test')(this.$v) ? this : EMPTY_OPT; }
        or(s){ return this.$v !== null ? this : fnOf(s, 'get')(); }
        stream(){ return JStream.ofIt(this.$v === null ? [] : [this.$v]); }
        equals(o){ return o instanceof Optional && jeq(this.$v, o.$v); }
        hashCode(){ return hcAny(this.$v); }
        toString(){ return this.$v === null ? 'Optional.empty' : 'Optional[' + jstr(this.$v, this.$k) + ']'; }
      }
      const EMPTY_OPT = new Optional(null);
      class OptionalNum extends JObject {
        constructor(v, t){ super(); this.$v = v === undefined ? null : v; this.$t = t; }
        $n(){ return this.$t === 'I' ? 'OptionalInt' : this.$t === 'J' ? 'OptionalLong' : 'OptionalDouble'; }
        isPresent(){ return this.$v !== null; } isEmpty(){ return this.$v === null; }
        $get(){ if (this.$v === null) throw nse('No value present (' + this.$n() + ' пустой)'); return this.$v; }
        getAsInt(){ return this.$get(); } getAsLong(){ return this.$get(); } getAsDouble(){ return this.$get(); } orElseThrow(){ return this.$get(); }
        orElse(d){ return this.$v !== null ? this.$v : d; } orElseGet(s){ return this.$v !== null ? this.$v : fnOf(s, this.$t === 'I' ? 'getAsInt' : 'getAsDouble')(); }
        ifPresent(f){ if (this.$v !== null) fnOf(f, 'accept')(this.$v); } ifPresentOrElse(f, r){ if (this.$v !== null) fnOf(f, 'accept')(this.$v); else fnOf(r, 'run')(); }
        toString(){ return this.$v === null ? this.$n() + '.empty' : this.$n() + '[' + (this.$t === 'D' ? dstr(this.$v) : String(this.$v)) + ']'; }
        equals(o){ return o instanceof OptionalNum && o.$t === this.$t && o.$v === this.$v; }
        static of(v){ return new OptionalNum(v, typeof v === 'bigint' ? 'J' : Number.isInteger(v) ? 'I' : 'D'); }
      }
      const OptionalInt = { of: v => new OptionalNum(v, 'I'), empty: () => new OptionalNum(null, 'I') };
      const OptionalDouble = { of: v => new OptionalNum(v, 'D'), empty: () => new OptionalNum(null, 'D') };
      const OptionalLong = { of: v => new OptionalNum(v, 'J'), empty: () => new OptionalNum(null, 'J') };
      // ── суммы double как в Java (с компенсацией Кэхэна: DoubleStream.sum(), Collectors.summingDouble) ──
      function dsum(xs){ let s = 0, c = 0, simple = 0; for (const v of xs) { simple += v; const t = v - c, velvel = s + t; c = (velvel - s) - t; s = velvel; } const tmp = s - c; return Number.isNaN(tmp) && !Number.isFinite(simple) ? simple : tmp; }
      class IntSummaryStatistics extends JObject {
        constructor(){ super(); this.n = 0n; this.s = 0n; this.mn = 2147483647; this.mx = -2147483648; this.$t = 'I'; }
        accept(v){ this.n++; this.s += BigInt(v); this.mn = Math.min(this.mn, v); this.mx = Math.max(this.mx, v); }
        getCount(){ return this.n; } getSum(){ return this.s; } getMin(){ return this.mn; } getMax(){ return this.mx; } getAverage(){ return this.n ? Number(this.s) / Number(this.n) : 0; }
        toString(){ return 'IntSummaryStatistics{count=' + this.n + ', sum=' + this.s + ', min=' + this.mn + ', average=' + fixedJ(this.getAverage(), 6) + ', max=' + this.mx + '}'; }
      }
      class DoubleSummaryStatistics extends JObject {
        constructor(){ super(); this.xs = []; this.mn = Infinity; this.mx = -Infinity; }
        accept(v){ this.xs.push(v); this.mn = Math.min(this.mn, v); this.mx = Math.max(this.mx, v); }
        getCount(){ return BigInt(this.xs.length); } getSum(){ return dsum(this.xs); } getMin(){ return this.mn; } getMax(){ return this.mx; } getAverage(){ return this.xs.length ? this.getSum() / this.xs.length : 0; }
        toString(){ return 'DoubleSummaryStatistics{count=' + this.xs.length + ', sum=' + fixedJ(this.getSum(), 6) + ', min=' + fixedJ(this.mn, 6) + ', average=' + fixedJ(this.getAverage(), 6) + ', max=' + fixedJ(this.mx, 6) + '}'; }
      }
      // ── потоки (Stream, IntStream, LongStream, DoubleStream): ленивые, на генераторах JS ──
      class JStream extends JObject {
        constructor(src, t, k){ super(); this.$src = src; this.$t = t || 'O'; this.$k = k || (t === 'D' ? 'D' : null); }
        static ofIt(xs, k){ return new JStream(() => xs[Symbol.iterator](), 'O', k); }
        static ofArr(a, k){ return JStream.ofIt(a, k); }
        $mk(src, t, k){ const T = t || this.$t; return new (T === 'I' ? IntStream : T === 'J' ? LongStream : T === 'D' ? DoubleStream : JStream)(src, T, k === undefined ? this.$k : k); }
        [Symbol.iterator](){ return this.$src(); }
        $fn(f, n){ return fnOf(f, n); }
        filter(p){ p = fnOf(p, 'test'); const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) if (p(x)) yield x; }); }
        map(f){ f = fnOf(f, this.$t === 'O' ? 'apply' : this.$t === 'I' ? 'applyAsInt' : this.$t === 'J' ? 'applyAsLong' : 'applyAsDouble'); const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) yield f(x); }, this.$t, this.$t === 'O' ? null : undefined); }
        mapToInt(f){ f = fnOf(f, 'applyAsInt'); const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) yield f(x); }, 'I', null); }
        mapToLong(f){ f = fnOf(f, 'applyAsLong'); const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) yield f(x); }, 'J', null); }
        mapToDouble(f){ f = fnOf(f, 'applyAsDouble'); const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) yield f(x); }, 'D', 'D'); }
        mapToObj(f){ f = fnOf(f, 'apply'); const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) yield f(x); }, 'O', null); }
        boxed(){ return this.$mk(this.$src, 'O', this.$t === 'D' ? 'D' : null); }
        asDoubleStream(){ const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) yield Number(x); }, 'D', 'D'); }
        asLongStream(){ const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) yield BigInt(x); }, 'J', null); }
        flatMap(f){ f = fnOf(f, 'apply'); const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) { const r = f(x); if (r != null) yield* iter(r.$src); } }, this.$t, null); }
        distinct(){ const s = this.$src; return this.$mk(function* (){ const seen = new HashSet(); for (const x of iter(s)) if (seen.add(x)) yield x; }); }
        sorted(c){ const s = this.$src, t = this.$t; return this.$mk(function* (){ const a = [...iter(s)]; if (t === 'O') { const f = cmpOf(c); a.sort((x, y) => f(x, y)); } else a.sort((x, y) => x < y ? -1 : x > y ? 1 : 0); yield* a; }); }
        peek(f){ f = fnOf(f, 'accept'); const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) { f(x); yield x; } }); }
        limit(n){ n = Number(n); if (n < 0) throw new EX.IllegalArgumentException('limit(' + n + ')'); const s = this.$src; return this.$mk(function* (){ if (n <= 0) return; let i = 0; for (const x of iter(s)) { yield x; if (++i >= n) return; } }); }
        skip(n){ n = Number(n); const s = this.$src; return this.$mk(function* (){ let i = 0; for (const x of iter(s)) if (i++ >= n) yield x; }); }
        takeWhile(p){ p = fnOf(p, 'test'); const s = this.$src; return this.$mk(function* (){ for (const x of iter(s)) { if (!p(x)) return; yield x; } }); }
        dropWhile(p){ p = fnOf(p, 'test'); const s = this.$src; return this.$mk(function* (){ let on = true; for (const x of iter(s)) { if (on && p(x)) continue; on = false; yield x; } }); }
        forEach(f){ f = fnOf(f, 'accept'); for (const x of iter(this.$src)) f(x); }
        forEachOrdered(f){ this.forEach(f); }
        toArray(){ const a = [...iter(this.$src)]; return this.$t === 'I' ? Int32Array.from(a) : this.$t === 'D' ? Float64Array.from(a) : this.$t === 'J' ? BigInt64Array.from(a) : a; }
        reduce(a, b){
          if (b === undefined) { const f = fnOf(a, this.$t === 'O' ? 'apply' : this.$t === 'I' ? 'applyAsInt' : this.$t === 'J' ? 'applyAsLong' : 'applyAsDouble'); let acc, has = false; for (const x of iter(this.$src)) { acc = has ? f(acc, x) : x; has = true; } return this.$t === 'O' ? (has ? Optional.of(acc) : EMPTY_OPT) : new OptionalNum(has ? acc : null, this.$t); }
          const f = fnOf(b, this.$t === 'O' ? 'apply' : this.$t === 'I' ? 'applyAsInt' : this.$t === 'J' ? 'applyAsLong' : 'applyAsDouble'); let acc = a; for (const x of iter(this.$src)) acc = f(acc, x); return acc;
        }
        collect(c){ if (!c || typeof c.$c !== 'function') throw new EX.IllegalArgumentException('collect(…) — нужен Collectors.toList(), toSet(), joining() …'); return c.$c(iter(this.$src), this.$k); }
        toList(){ const l = roList([...iter(this.$src)].map(x => x), this.$k); for (const x of l.$a) void x; return l; }
        min(c){ return this.$mm(c, -1); } max(c){ return this.$mm(c, 1); }
        $mm(c, sg){ const f = this.$t === 'O' ? cmpOf(c) : (x, y) => x < y ? -1 : x > y ? 1 : 0; let best, has = false; for (const x of iter(this.$src)) { if (!has || sg * f(x, best) > 0) best = x; has = true; } return this.$t === 'O' ? (has ? Optional.ofNullable(best) : EMPTY_OPT) : new OptionalNum(has ? best : null, this.$t); }
        count(){ let n = 0n; for (const x of iter(this.$src)) { void x; n++; } return n; }
        sum(){ const a = [...iter(this.$src)]; if (this.$t === 'I') { let s = 0; for (const v of a) s = (s + v) | 0; return s; } if (this.$t === 'J') { let s = 0n; for (const v of a) s = BigInt.asIntN(64, s + v); return s; } return dsum(a); }
        average(){ const a = [...iter(this.$src)]; if (!a.length) return new OptionalNum(null, 'D'); if (this.$t === 'D') return new OptionalNum(dsum(a) / a.length, 'D'); let s = 0; for (const v of a) s += Number(v); return new OptionalNum(s / a.length, 'D'); }
        summaryStatistics(){ const st = this.$t === 'D' ? new DoubleSummaryStatistics() : new IntSummaryStatistics(); for (const x of iter(this.$src)) st.accept(x); return st; }
        anyMatch(p){ p = fnOf(p, 'test'); for (const x of iter(this.$src)) if (p(x)) return true; return false; }
        allMatch(p){ p = fnOf(p, 'test'); for (const x of iter(this.$src)) if (!p(x)) return false; return true; }
        noneMatch(p){ return !this.anyMatch(p); }
        findFirst(){ for (const x of iter(this.$src)) return this.$t === 'O' ? Optional.of(x) : new OptionalNum(x, this.$t); return this.$t === 'O' ? EMPTY_OPT : new OptionalNum(null, this.$t); }
        findAny(){ return this.findFirst(); }
        iterator(){ return new JIter(this.$src(), null); }
        parallel(){ return this; } sequential(){ return this; } unordered(){ return this; } close(){}
        static of(xs){ return JStream.ofIt(Array.isArray(xs) ? xs : [xs]); }
        static ofNullable(x){ return JStream.ofIt(x == null ? [] : [x]); }
        static empty(){ return JStream.ofIt([]); }
        static iterate(seed, a, b){ const T = this === JStream ? 'O' : this.$T; const mk = g => new this(g, T); if (b === undefined) { const f = fnOf(a, T === 'O' ? 'apply' : T === 'I' ? 'applyAsInt' : 'applyAsDouble'); return mk(function* (){ let x = seed; for (;;) { yield x; x = f(x); } }); } const p = fnOf(a, 'test'), f = fnOf(b, T === 'O' ? 'apply' : T === 'I' ? 'applyAsInt' : 'applyAsDouble'); return mk(function* (){ for (let x = seed; p(x); x = f(x)) yield x; }); }
        static generate(s){ const T = this === JStream ? 'O' : this.$T; const f = fnOf(s, T === 'O' ? 'get' : T === 'I' ? 'getAsInt' : 'getAsDouble'); return new this(function* (){ for (;;) yield f(); }, T); }
        static concat(a, b){ return new this(function* (){ yield* iter(a.$src); yield* iter(b.$src); }, a.$t); }
      }
      class IntStream extends JStream {
        static ofArr(a){ return new IntStream(() => a[Symbol.iterator](), 'I'); }
        static of(xs){ return IntStream.ofArr(xs instanceof Int32Array ? xs : Int32Array.from(xs)); }
        static range(a, b){ return new IntStream(function* (){ for (let i = a; i < b; i++) yield i; }, 'I'); }
        static rangeClosed(a, b){ return new IntStream(function* (){ for (let i = a; i <= b; i++) yield i; }, 'I'); }
        static empty(){ return IntStream.ofArr([]); }
      }
      IntStream.$T = 'I';
      class LongStream extends JStream {
        static of(xs){ return new LongStream(() => Array.from(xs, BigInt)[Symbol.iterator](), 'J'); }
        static range(a, b){ return new LongStream(function* (){ for (let i = BigInt(a); i < BigInt(b); i++) yield i; }, 'J'); }
        static rangeClosed(a, b){ return new LongStream(function* (){ for (let i = BigInt(a); i <= BigInt(b); i++) yield i; }, 'J'); }
        static empty(){ return LongStream.of([]); }
      }
      LongStream.$T = 'J';
      class DoubleStream extends JStream { static of(xs){ const a = Array.from(xs, Number); return new DoubleStream(() => a[Symbol.iterator](), 'D', 'D'); } static empty(){ return DoubleStream.of([]); } }
      DoubleStream.$T = 'D';
      // ── Collectors: объект со сборкой { $c(элементы, тип) } ──
      const C1 = f => ({ $c: f });
      const Collectors = {
        toList: () => C1((xs, k) => { const l = new ArrayList(); for (const x of xs) l.$a.push(x); if (k) l.$k = k; return l; }),
        toUnmodifiableList: () => C1((xs, k) => roList([...xs], k)),
        toSet: () => C1((xs, k) => { const s = new HashSet(); for (const x of xs) s.add(x); if (k) s.$k = k; return s; }),
        toUnmodifiableSet: () => C1(xs => roSet([...xs])),
        joining: (sep, pre, suf) => C1(xs => (pre == null ? '' : pre) + [...xs].map(x => jstr(x)).join(sep == null ? '' : sep) + (suf == null ? '' : suf)),
        counting: () => C1(xs => { let n = 0n; for (const x of xs) { void x; n++; } return n; }),
        summingInt: f => C1(xs => { f = fnOf(f, 'applyAsInt'); let s = 0; for (const x of xs) s = (s + f(x)) | 0; return s; }),
        summingLong: f => C1(xs => { f = fnOf(f, 'applyAsLong'); let s = 0n; for (const x of xs) s += BigInt(f(x)); return s; }),
        summingDouble: f => C1(xs => { f = fnOf(f, 'applyAsDouble'); return dsum([...xs].map(f)); }),
        averagingInt: f => C1(xs => { f = fnOf(f, 'applyAsInt'); const a = [...xs]; if (!a.length) return 0; let s = 0; for (const x of a) s += f(x); return s / a.length; }),
        averagingLong: f => C1(xs => { f = fnOf(f, 'applyAsLong'); const a = [...xs]; if (!a.length) return 0; let s = 0; for (const x of a) s += Number(f(x)); return s / a.length; }),
        averagingDouble: f => C1(xs => { f = fnOf(f, 'applyAsDouble'); const a = [...xs].map(f); return a.length ? dsum(a) / a.length : 0; }),
        summarizingInt: f => C1(xs => { f = fnOf(f, 'applyAsInt'); const st = new IntSummaryStatistics(); for (const x of xs) st.accept(f(x)); return st; }),
        minBy: c => C1(xs => { const f = cmpOf(c); let b, h = false; for (const x of xs) { if (!h || f(x, b) < 0) b = x; h = true; } return h ? Optional.of(b) : EMPTY_OPT; }),
        maxBy: c => C1(xs => { const f = cmpOf(c); let b, h = false; for (const x of xs) { if (!h || f(x, b) > 0) b = x; h = true; } return h ? Optional.of(b) : EMPTY_OPT; }),
        groupingBy: (kf, a, b) => { const sup = b === undefined ? null : a, down = b === undefined ? a : b; return C1((xs, k) => {
          kf = fnOf(kf, 'apply'); const groups = new LinkedHashMap(), order = [];
          for (const x of xs) { const key = kf(x); if (key == null) throw new EX.NullPointerException('groupingBy: ключ null'); let g = groups.$find(key); if (!g) { groups.put(key, []); g = groups.$find(key); order.push(key); } g.v.push(x); }
          const out = sup ? fnOf(sup, 'get')() : new HashMap();
          for (const e of groups.$entries()) out.put(e.k, down && down.$c ? down.$c(e.v, k) : (() => { const l = new ArrayList(); l.$a = e.v; if (k) l.$k = k; return l; })());
          return out;
        }); },
        partitioningBy: (p, down) => C1((xs, k) => { p = fnOf(p, 'test'); const f = [], t = []; for (const x of xs) (p(x) ? t : f).push(x); const m = new LinkedHashMap(); const mk = a => down ? down.$c(a, k) : (() => { const l = new ArrayList(); l.$a = a; if (k) l.$k = k; return l; })(); m.put(false, mk(f)); m.put(true, mk(t)); return m; }),
        toMap: (kf, vf, merge, sup) => C1(xs => { kf = fnOf(kf, 'apply'); vf = fnOf(vf, 'apply'); const mf = merge ? fnOf(merge, 'apply') : null; const m = sup ? fnOf(sup, 'get')() : new HashMap(); for (const x of xs) { const key = kf(x), v = vf(x); if (v == null) throw new EX.NullPointerException('toMap: значение null'); const e = m.$find(key); if (e) { if (!mf) throw new EX.IllegalStateException('Duplicate key ' + jstr(key) + ' (повтор ключа: значения ' + jstr(e.v) + ' и ' + jstr(v) + ')'); m.put(key, mf(e.v, v)); } else m.put(key, v); } return m; }),
        mapping: (f, down) => C1((xs, k) => { f = fnOf(f, 'apply'); return down.$c([...xs].map(f), null); }),
        filtering: (p, down) => C1((xs, k) => { p = fnOf(p, 'test'); return down.$c([...xs].filter(p), k); }),
        toCollection: s => C1(xs => { const c = fnOf(s, 'get')(); for (const x of xs) c.add(x); return c; }),
        collectingAndThen: (down, f) => C1((xs, k) => fnOf(f, 'apply')(down.$c(xs, k))),
        reducing: (a, b) => C1(xs => { if (b === undefined) { const f = fnOf(a, 'apply'); let acc, h = false; for (const x of xs) { acc = h ? f(acc, x) : x; h = true; } return h ? Optional.of(acc) : EMPTY_OPT; } const f = fnOf(b, 'apply'); let acc = a; for (const x of xs) acc = f(acc, x); return acc; }),
      };
      // ── Random: как java.util.Random (тот же генератор: одинаковое зерно — одинаковые числа) ──
      const M24 = 16777216, MH = 0x5DE, ML = 0xECE66D;
      let seedUniq = 8682522807148012n;
      class Random extends JObject {
        constructor(seed){ super(); if (seed === undefined || seed === null) { seedUniq = BigInt.asIntN(64, seedUniq * 1181783497276652981n); seed = seedUniq ^ BigInt(Math.floor(Math.random() * 2 ** 52)); } this.setSeed(seed); }
        setSeed(seed){ const s = BigInt.asUintN(48, BigInt(seed) ^ 0x5DEECE66Dn); this.$h = Number(s >> 24n); this.$l = Number(s & 0xFFFFFFn); this.$g = null; }
        $next(bits){
          const l = this.$l, h = this.$h, p = l * ML + 0xB, lo = p % M24, carry = Math.floor(p / M24);
          const hi = (h * ML + l * MH + carry) % M24;
          this.$h = hi; this.$l = lo;
          const v = hi * M24 + lo;   // 48 бит
          return Math.floor(v / Math.pow(2, 48 - bits)) | 0;
        }
        nextInt(a, b){
          if (a === undefined) return this.$next(32);
          if (b !== undefined) { if (a >= b) throw new EX.IllegalArgumentException('bound must be greater than origin'); let r = this.$next(32); const n = (b - a) | 0, m = n - 1; if ((n & m) === 0) return (r & m) + a; if (n > 0) { for (let u = r >>> 1; u + m - (r = u % n) < 0 || (u + m - r) > 2147483647; u = this.$next(32) >>> 1); return r + a; } while (r < a || r >= b) r = this.$next(32); return r; }
          const bound = a;
          if (bound <= 0) throw new EX.IllegalArgumentException('bound must be positive (граница должна быть > 0): ' + bound);
          if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.$next(31))) >> 31n);
          let bits, val;
          do { bits = this.$next(31); val = bits % bound; } while (bits - val + (bound - 1) > 2147483647);
          return val;
        }
        nextLong(a, b){ const v = BigInt.asIntN(64, (BigInt(this.$next(32)) << 32n) + BigInt(this.$next(32))); if (a === undefined) return v; const lo = b === undefined ? 0n : BigInt(a), hi = b === undefined ? BigInt(a) : BigInt(b); const n = hi - lo; return lo + ((v % n) + n) % n; }
        nextDouble(a, b){ const d = (this.$next(26) * 134217728 + this.$next(27)) / 9007199254740992; if (a === undefined) return d; if (b === undefined) return d * a; return a + d * (b - a); }
        nextFloat(){ return this.$next(24) / 16777216; }
        nextBoolean(){ return this.$next(1) !== 0; }
        nextGaussian(){ if (this.$g !== null) { const g = this.$g; this.$g = null; return g; } let v1, v2, s; do { v1 = 2 * this.nextDouble() - 1; v2 = 2 * this.nextDouble() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0); const m = Math.sqrt(-2 * Math.log(s) / s); this.$g = v2 * m; return v1 * m; }
        ints(n, a, b){ const self = this; if (b === undefined) { b = a; a = n; n = null; } return new IntStream(function* (){ for (let i = 0n; n === null || i < BigInt(n); i++) yield self.nextInt(a, b); }, 'I'); }
        doubles(n){ const self = this; return new DoubleStream(function* (){ for (let i = 0n; i < BigInt(n); i++) yield self.nextDouble(); }, 'D'); }
      }
      const TLR = { current: () => TLR.$r || (TLR.$r = new Random()) };
      // ── Collections, Arrays, Objects, Comparator, функциональные интерфейсы ──
      const natural = (a, b) => cmpAny(a, b);
      const listOf = l => { if (l == null) throw npe('список'); return l; };
      const Collections = {
        sort: (l, c) => listOf(l).sort(c), reverse: l => { listOf(l); if (l.$ro === 1) throw uoe(); l.$a.reverse(); l.$mc++; },
        shuffle: (l, r) => { listOf(l); r = r || new Random(); for (let i = l.size(); i > 1; i--) { const j = r.nextInt(i), t = l.$a[i - 1]; l.$a[i - 1] = l.$a[j]; l.$a[j] = t; } l.$mc++; },
        max: (c, cmp) => { const f = cmpOf(cmp); let b, h = false; for (const x of it(c)) { if (!h || f(x, b) > 0) b = x; h = true; } if (!h) throw nse('коллекция пуста'); return b; },
        min: (c, cmp) => { const f = cmpOf(cmp); let b, h = false; for (const x of it(c)) { if (!h || f(x, b) < 0) b = x; h = true; } if (!h) throw nse('коллекция пуста'); return b; },
        unmodifiableList: l => { const r = ArrayList.wrap(listOf(l).$a, 1); r.$k = l.$k; return r; }, unmodifiableCollection: c => Collections.unmodifiableList(new ArrayList(c)),
        unmodifiableSet: s => { const r = new LinkedHashSet(s); r.$ro = true; return r; }, unmodifiableMap: m => { const r = new LinkedHashMap(m); r.$ro = true; return r; },
        synchronizedList: l => l, synchronizedMap: m => m, synchronizedSet: s => s,
        emptyList: () => roList([]), emptySet: () => roSet([]), emptyMap: () => roMap(new HashMap()),
        singletonList: x => ArrayList.wrap([x], 1), singleton: x => { const s = new HashSet(); s.add(x); s.$ro = true; return s; }, singletonMap: (k, v) => { const m = new HashMap(); m.put(k, v); return roMap(m); },
        nCopies: (n, x) => { if (n < 0) throw new EX.IllegalArgumentException('nCopies: ' + n); return ArrayList.wrap(new Array(n).fill(x), 1); },
        frequency: (c, o) => { let n = 0; for (const x of it(c)) if (jeq(o, x)) n++; return n; },
        swap: (l, i, j) => { const t = l.get(i); l.set(i, l.get(j)); l.set(j, t); },
        addAll: (c, xs) => { let ch = false; for (const x of xs) if (c.add(x) !== false) ch = true; return ch; },
        fill: (l, x) => { for (let i = 0; i < l.size(); i++) l.set(i, x); },
        reverseOrder: c => { if (c) { const f = cmpOf(c); return (a, b) => f(b, a); } return (a, b) => natural(b, a); },
        disjoint: (a, b) => { for (const x of it(a)) if (b.contains(x)) return false; return true; },
        binarySearch: (l, key, c) => { const f = cmpOf(c); let lo = 0, hi = l.size() - 1; while (lo <= hi) { const m = (lo + hi) >>> 1, r = f(l.get(m), key); if (r < 0) lo = m + 1; else if (r > 0) hi = m - 1; else return m; } return -(lo + 1); },
        rotate: (l, d) => { const n = l.size(); if (!n) return; d = ((d % n) + n) % n; const a = l.$a.splice(n - d, d); l.$a.unshift(...a); l.$mc++; },
      };
      const ELF = a => a instanceof Float64Array ? 'D' : a instanceof Float32Array ? 'F' : null;
      const arrStr = a => a == null ? 'null' : '[' + Array.from(a, x => jstr(x, ELF(a))).join(', ') + ']';
      const deepStr = a => a == null ? 'null' : '[' + Array.from(a, x => (Array.isArray(x) || ArrayBuffer.isView(x)) ? deepStr(x) : jstr(x, ELF(a))).join(', ') + ']';
      const rng = (a, f, t) => { if (f < 0 || t > a.length || f > t) throw aioobe(f < 0 ? f : t, a.length); };
      const Arrays = {
        toString: arrStr, deepToString: deepStr,
        sort(a, b, c, d){
          if (a == null) throw npe('sort');
          let from = 0, to = a.length, cmp = null;
          if (typeof b === 'number') { from = b; to = c; cmp = d || null; rng(a, from, to); } else cmp = b || null;
          if (ArrayBuffer.isView(a) && !cmp) { a.subarray(from, to).sort(); return; }
          const part = Array.prototype.slice.call(a, from, to), f = cmpOf(cmp);
          part.sort((x, y) => f(x, y));
          for (let i = 0; i < part.length; i++) a[from + i] = part[i];
        },
        fill(a, b, c, d){ if (a == null) throw npe('fill'); if (d === undefined) { a.fill(b); return; } rng(a, b, c); a.fill(d, b, c); },
        asList(xs){ if (!Array.isArray(xs)) xs = [xs]; return ArrayList.wrap(xs, 'F'); },
        copyOf(a, n){ if (a == null) throw npe('copyOf'); if (n < 0) throw new EX.NegativeArraySizeException(String(n)); const r = new a.constructor(n); const m = Math.min(n, a.length); for (let i = 0; i < m; i++) r[i] = a[i]; if (Array.isArray(a)) { const z = a.$jt === 'C' ? CH(0) : a.$jt === 'Z' ? false : null; for (let i = m; i < n; i++) r[i] = z; if (a.$jt) r.$jt = a.$jt; } return r; },
        copyOfRange(a, f, t){ if (f < 0 || f > a.length) throw aioobe(f, a.length); if (f > t) throw new EX.IllegalArgumentException(f + ' > ' + t); const r = Arrays.copyOf(Array.isArray(a) ? a.slice(f) : a.subarray(f), t - f); return r; },
        equals(a, b){ if (a === b) return true; if (a == null || b == null || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!jeq(a[i], b[i])) return false; return true; },
        deepEquals(a, b){ if (a === b) return true; if (a == null || b == null || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; if ((Array.isArray(x) || ArrayBuffer.isView(x)) ? !Arrays.deepEquals(x, y) : !jeq(x, y)) return false; } return true; },
        hashCode(a){ if (a == null) return 0; let h = 1; for (const x of a) h = (Math.imul(31, h) + hcAny(x, a instanceof Float64Array ? 'double' : undefined)) | 0; return h; },
        binarySearch(a, key){ let lo = 0, hi = a.length - 1; while (lo <= hi) { const m = (lo + hi) >>> 1, r = cmpAny(a[m], key); if (r < 0) lo = m + 1; else if (r > 0) hi = m - 1; else return m; } return -(lo + 1); },
        stream(a, f, t){ if (a == null) throw npe('stream'); const xs = f === undefined ? a : a.slice(f, t); if (xs instanceof Int32Array || xs instanceof Int16Array || xs instanceof Int8Array) return new IntStream(() => xs[Symbol.iterator](), 'I'); if (xs instanceof Float64Array || xs instanceof Float32Array) return new DoubleStream(() => xs[Symbol.iterator](), 'D', 'D'); if (xs instanceof BigInt64Array) return new LongStream(() => xs[Symbol.iterator](), 'J'); return JStream.ofIt(xs); },
        setAll(a, f){ f = fnOf(f, 'apply'); for (let i = 0; i < a.length; i++) a[i] = f(i); },
      };
      const Objects = {
        equals: jeq, hash: xs => Arrays.hashCode(xs), hashCode: o => o == null ? 0 : hcAny(o), toString: (o, d) => o == null && d !== undefined ? d : jstr(o),
        requireNonNull(o, m){ if (o == null) throw new EX.NullPointerException(m === undefined ? null : typeof m === 'function' ? m() : m); return o; },
        isNull: o => o == null, nonNull: o => o != null, requireNonNullElse: (a, b) => a != null ? a : Objects.requireNonNull(b, 'defaultObj'), requireNonNullElseGet: (a, s) => a != null ? a : fnOf(s, 'get')(),
        compare: (a, b, c) => a === b ? 0 : cmpOf(c)(a, b), checkIndex: (i, n) => { if (!(i >= 0 && i < n)) throw ioobe(i, n); return i; },
      };
      const keyCmp = f => { f = fnOf(f, 'apply'); return (a, b) => cmpAny(f(a), f(b)); };
      const Comparator = {
        comparing: (f, c) => { f = fnOf(f, 'apply'); if (c) { const g = cmpOf(c); return (a, b) => g(f(a), f(b)); } return (a, b) => cmpAny(f(a), f(b)); },
        comparingInt: f => { f = fnOf(f, 'applyAsInt'); return (a, b) => { const x = f(a), y = f(b); return x < y ? -1 : x > y ? 1 : 0; }; },
        comparingDouble: f => { f = fnOf(f, 'applyAsDouble'); return (a, b) => cmpAny(f(a), f(b)); },
        comparingLong: f => { f = fnOf(f, 'applyAsLong'); return (a, b) => cmpAny(f(a), f(b)); },
        naturalOrder: () => natural, reverseOrder: () => (a, b) => natural(b, a),
        nullsFirst: c => { const f = cmpOf(c); return (a, b) => a == null ? (b == null ? 0 : -1) : b == null ? 1 : f(a, b); },
        nullsLast: c => { const f = cmpOf(c); return (a, b) => a == null ? (b == null ? 0 : 1) : b == null ? -1 : f(a, b); },
      };
      const FX = {   // методы по умолчанию у функциональных интерфейсов: f.andThen(g), c.reversed(), p.negate() …
        andThen: (f, g) => { f = fnOf(f, 'apply'); g = fnOf(g, 'apply'); return (...a) => g(f(...a)); },
        andThenC: (f, g) => { f = fnOf(f, 'accept'); g = fnOf(g, 'accept'); return (...a) => { f(...a); g(...a); }; },
        compose: (f, g) => { f = fnOf(f, 'apply'); g = fnOf(g, 'apply'); return x => f(g(x)); },
        negate: p => { p = fnOf(p, 'test'); return (...a) => !p(...a); },
        and: (p, q) => { p = fnOf(p, 'test'); q = fnOf(q, 'test'); return (...a) => p(...a) && q(...a); },
        or: (p, q) => { p = fnOf(p, 'test'); q = fnOf(q, 'test'); return (...a) => p(...a) || q(...a); },
        reversed: c => { const f = cmpOf(c); return (a, b) => f(b, a); },
        thenComparing: (c, x, c2) => { const f = cmpOf(c); const g = c2 !== undefined ? Comparator.comparing(x, c2) : typeof x === 'function' && x.length !== 1 ? x : typeof x === 'function' ? keyCmp(x) : typeof x.compare === 'function' ? cmpOf(x) : keyCmp(x); return (a, b) => f(a, b) || g(a, b); },
        thenComparingInt: (c, k) => FX.thenComparing(c, Comparator.comparingInt(k)), thenComparingDouble: (c, k) => FX.thenComparing(c, Comparator.comparingDouble(k)), thenComparingLong: (c, k) => FX.thenComparing(c, Comparator.comparingLong(k)),
      };
      const Fn = { identity: () => x => x };
      const Pred = { not: p => FX.negate(p), isEqual: o => x => jeq(o, x) };
      const BinOp = { minBy: c => { const f = cmpOf(c); return (a, b) => f(a, b) <= 0 ? a : b; }, maxBy: c => { const f = cmpOf(c); return (a, b) => f(a, b) >= 0 ? a : b; } };
      const MapS = {
        of: kv => { const m = new HashMap(); for (let i = 0; i < kv.length; i += 2) { if (kv[i] == null || kv[i + 1] == null) throw new EX.NullPointerException('Map.of: null нельзя'); if (m.containsKey(kv[i])) throw new EX.IllegalArgumentException('Map.of: повтор ключа ' + jstr(kv[i])); m.put(kv[i], kv[i + 1]); } return roMap(m); },
        entry: (k, v) => { if (k == null || v == null) throw new EX.NullPointerException('Map.entry: null нельзя'); return new MapEntry({ k, v }, null, true); },
        copyOf: m => roMap(new HashMap(m)), ofEntries: es => { const m = new HashMap(); for (const e of es) m.put(e.getKey(), e.getValue()); return roMap(m); },
      };
      const EntryS = { comparingByKey: c => { const f = cmpOf(c); return (a, b) => f(a.getKey(), b.getKey()); }, comparingByValue: c => { const f = cmpOf(c); return (a, b) => f(a.getValue(), b.getValue()); } };
      class SimpleEntry extends MapEntry { constructor(k, v){ super(k instanceof MapEntry ? { k: k.getKey(), v: k.getValue() } : { k, v }, null, false); } }
      const UUID = { randomUUID: () => { const s = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }); return { toString: () => s, equals: o => o && String(o) === s, hashCode: () => strHash(s) }; } };
      const LOC = n => ({ toString: () => n, $loc: true });
      const Locale = { ROOT: LOC(''), US: LOC('en_US'), ENGLISH: LOC('en'), UK: LOC('en_GB'), GERMANY: LOC('de_DE'), FRANCE: LOC('fr_FR'), getDefault: () => Locale.ROOT, forLanguageTag: t => LOC(t) };
      const TimeUnit = { MILLISECONDS: { sec: n => Number(n) / 1000, toString: () => 'MILLISECONDS' }, SECONDS: { sec: n => Number(n), toString: () => 'SECONDS' } };
      const Instant = { now: () => { const t = Date.now(); return { toEpochMilli: () => BigInt(t), $t: t, toString: () => new Date(t).toISOString() }; } };
      const mkDur = ms => ({ toMillis: () => BigInt(Math.round(ms)), getSeconds: () => BigInt(Math.floor(ms / 1000)), toSeconds: () => BigInt(Math.floor(ms / 1000)), toString: () => 'PT' + (ms / 1000) + 'S' });
      const Duration = { ofMillis: ms => mkDur(Number(ms)), ofSeconds: s => mkDur(Number(s) * 1000), between: (a, b) => mkDur(b.$t - a.$t) };
      // ── «Студия 3D»: Vector3 как в песочнице, плюс то, что ждут от Java (Vector3.up, distance …) ──
      class V3 extends V3B {
        static get zero(){ return new V3(0, 0, 0); } static get one(){ return new V3(1, 1, 1); } static get up(){ return new V3(0, 1, 0); } static get down(){ return new V3(0, -1, 0); }
        static get forward(){ return new V3(0, 0, 1); } static get back(){ return new V3(0, 0, -1); } static get left(){ return new V3(-1, 0, 0); } static get right(){ return new V3(1, 0, 0); }
        static distance(a, b){ return Math.hypot(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
        static lerp(a, b, t){ return new V3(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t); }
        add(o){ return new V3(this.X + o.X, this.Y + o.Y, this.Z + o.Z); } sub(o){ return new V3(this.X - o.X, this.Y - o.Y, this.Z - o.Z); }
        mul(k){ return typeof k === 'number' ? new V3(this.X * k, this.Y * k, this.Z * k) : new V3(this.X * k.X, this.Y * k.Y, this.Z * k.Z); }
        div(k){ return typeof k === 'number' ? new V3(this.X / k, this.Y / k, this.Z / k) : new V3(this.X / k.X, this.Y / k.Y, this.Z / k.Z); }
        get Magnitude(){ return Math.hypot(this.X, this.Y, this.Z); }
        get Unit(){ const m = this.Magnitude || 1; return new V3(this.X / m, this.Y / m, this.Z / m); }
        Lerp(o, a){ return V3.lerp(this, o, a); } Dot(o){ return this.X * o.X + this.Y * o.Y + this.Z * o.Z; }
        Cross(o){ return new V3(this.Y * o.Z - this.Z * o.Y, this.Z * o.X - this.X * o.Z, this.X * o.Y - this.Y * o.X); }
        FuzzyEq(o, e = 1e-5){ return Math.abs(this.X - o.X) <= e && Math.abs(this.Y - o.Y) <= e && Math.abs(this.Z - o.Z) <= e; }
        Distance(o){ return V3.distance(this, o); }
        Angle(o){ const d = Math.sqrt(this.Dot(this) * o.Dot(o)); return d < 1e-15 ? 0 : Math.acos(Math.max(-1, Math.min(1, this.Dot(o) / d))) * 180 / Math.PI; }
        equals(o){ return isV(o) && o.X === this.X && o.Y === this.Y && o.Z === this.Z; }
        hashCode(){ return hcAny(this); }
        toString(){ return jstr(this); }
      }
      // ── всё, что видит код Java по имени ($A.Имя) ──
      const A = {
        Object: JObject, Enum: JEnum, Record: JRecord, ...EX,
        Integer, Long, Double, Float, Short, Byte, Boolean: Bool, Character, Math: Object.assign(Object.create(null), { PI: Math.PI, E: Math.E, TAU: Math.PI * 2 }), StrictMath: null,
        Objects, Arrays, Collections, Thread: {}, Comparator, Function: Fn, UnaryOperator: Fn, Predicate: Pred, BinaryOperator: BinOp, IntUnaryOperator: Fn, DoubleUnaryOperator: Fn,
        StringBuilder, StringBuffer: StringBuilder, StringJoiner,
        ArrayList, LinkedList, Vector: ArrayList, Stack, ArrayDeque, PriorityQueue, HashMap, LinkedHashMap, TreeMap, Hashtable: HashMap, IdentityHashMap: HashMap, WeakHashMap: HashMap,
        ConcurrentHashMap: HashMap, CopyOnWriteArrayList: ArrayList, HashSet, LinkedHashSet, TreeSet, EnumMap, EnumSet,
        List: { of: xs => roList(xs || []), copyOf: c => roList([...it(c)]) }, Set: { of: xs => roSet(xs || []), copyOf: c => { const s = new HashSet(c); s.$ro = true; return s; } },
        Map: MapS, Map_Entry: EntryS, AbstractMap_SimpleEntry: SimpleEntry,
        Optional, OptionalInt, OptionalDouble, OptionalLong, Stream: JStream, IntStream, LongStream, DoubleStream, Collectors, IntSummaryStatistics, DoubleSummaryStatistics,
        Random, ThreadLocalRandom: TLR, UUID, Locale, TimeUnit, Instant, Duration, Vector3: V3, CFrame: env.CFrame,
      };
      A.StrictMath = A.Math;
      A.String = { CASE_INSENSITIVE_ORDER: (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { let x = a[i], y = b[i]; if (x !== y) { x = x.toUpperCase(); y = y.toUpperCase(); if (x !== y) { x = x.toLowerCase(); y = y.toLowerCase(); if (x !== y) return x.charCodeAt(0) - y.charCodeAt(0); } } } return a.length - b.length; } };
      for (const k of ['sqrt', 'cbrt', 'floor', 'ceil', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'log10', 'sinh', 'cosh', 'tanh', 'log1p', 'expm1', 'pow', 'hypot', 'random']) A.Math[k] = Math[k];
      Object.assign(LIBCLS, { ArrayList, LinkedList, HashMap, LinkedHashMap, TreeMap, HashSet, LinkedHashSet, TreeSet, ArrayDeque, PriorityQueue, Stack, StringBuilder, Optional, JColl, AbstractMapJ, Stream: JStream, IntStream,
        List: ArrayList, Collection: JColl, Map: AbstractMapJ, Set: HashSet, Iterable: JColl, Deque: ArrayDeque, Queue: JColl, Exception: EX.Exception, RuntimeException: EX.RuntimeException, Throwable });
      for (const n of Object.keys(EX)) LIBCLS[n] = EX[n];
      Object.assign(H, { S: SX, F: FX, JS: { BigInt, Math, Number, String } });   // JS — свои ссылки на BigInt, Math …: в переведённом коде это локальные имена (быстрее глобальных)
      // ── сопрограммы: wait(сек) / Thread.sleep(мс) внутри функций-генераторов ──
      const FRQ = [];
      let beatOn = false;
      function nextFrame(f){ FRQ.push(f); if (!beatOn && MODE === 'studio' && env.RunService) { beatOn = true; env.RunService.Heartbeat.Connect(beat); } else if (MODE !== 'studio') setTimeout(beat, 16); }
      const TIME = { deltaTime: 1 / 60, frame: 0 };
      function beat(dt){
        if (dt > 0) TIME.deltaTime = dt;
        TIME.frame++;
        for (const o of TICK) { if (!alive(o) || o.enabled === false) continue; if (o.$m.Update) callMsg(o, 'Update', [TIME.deltaTime]); if (o.$m.FixedUpdate) callMsg(o, 'FixedUpdate', [TIME.deltaTime]); }
        for (const f of FRQ.splice(0)) { try { f(); } catch (e) {} }
        for (const o of TICK) if (!o.$dead && o.enabled !== false && o.$m.LateUpdate) callMsg(o, 'LateUpdate', [TIME.deltaTime]);
      }
      const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
      function coRun(g, rt, owner){
        const co = { g, rt, owner, done: false };
        if (owner) { if (!owner.$cos) Object.defineProperty(owner, '$cos', { value: new Set() }); owner.$cos.add(co); }
        coStep(co, undefined);
        return co;
      }
      function coStep(co, v){
        if (co.done) return;
        if (co.owner && !alive(co.owner)) { co.done = true; return; }
        if (co.rt.ctx.setCurrent) co.rt.ctx.setCurrent(co.rt.name);
        let r;
        try { r = co.g.next(v); } catch (e) { co.done = true; if (co.owner && co.owner.$cos) co.owner.$cos.delete(co); if (!(e && e.$exit)) co.rt.rep(e); return; }
        if (r.done) { co.done = true; if (co.owner && co.owner.$cos) co.owner.$cos.delete(co); return; }
        const y = r.value;
        if (y && y.$w !== undefined) { const t0 = now(); setTimeout(() => coStep(co, (now() - t0) / 1000), Math.max(0, y.$w * 1000)); return; }
        if (y && y.$p !== undefined) { const p = y.$p; if (p && typeof p.then === 'function') p.then(x => coStep(co, x), e => { co.done = true; co.rt.rep(e); }); else coStep(co, p); return; }
        nextFrame(() => coStep(co, undefined));
      }
      H.W = s => ({ $w: Math.max(0, Number(s) || 0) });
      H.P = p => ({ $p: p });
      H.cofn = (gf, rt) => function (...a) { coRun(gf.apply(this, a), rt, null); };
      // ── базовый класс Script (как MonoBehaviour в Unity): start(), update(double dt), onTouched(Part hit, Player player) … ──
      const TICK = new Set(), ALLI = [];
      let CUR = null;
      class JScript extends JObject {
        constructor(){ super(); this.enabled = true; if (CUR) Object.defineProperty(this, '$rt', { value: CUR }); const p = this.$rt.scr.Parent; Object.defineProperty(this, '$par', { value: p, writable: true }); Object.defineProperty(this, '$pid', { value: (p && p.__id) || null, writable: true }); ALLI.push(this); }
        get Parent(){ return this.$rt.scr.Parent; } get script(){ return this.$rt.scr; }
        getParent(){ return this.Parent; } isEnabled(){ return this.enabled !== false; } setEnabled(v){ this.enabled = !!v; }
        print(...a){ this.$rt.out(a.map(x => jstr(x)).join(' ')); }
        delay(s, f){ const rt = this.$rt; setTimeout(() => { if (alive(this)) callFn(rt, f, 'run'); }, Math.max(0, Number(s) * 1000)); }
        spawn(f){ const rt = this.$rt; setTimeout(() => callFn(rt, f, 'run'), 0); }
        destroy(s){ const p = this.Parent; if (!p || typeof p.Destroy !== 'function') return; if (s > 0) setTimeout(() => p.Destroy(), s * 1000); else p.Destroy(); }
        toString(){ return (this.constructor.$q || 'Script') + '(' + jstr(this.Parent && this.Parent.Name) + ')'; }
      }
      function callFn(rt, f, name){ try { const r = typeof f === 'function' ? f() : f[name](); if (r && typeof r.next === 'function' && typeof r.throw === 'function') coRun(r, rt, null); } catch (e) { rt.rep(e); } }
      function alive(o){
        if (o.$dead) return false;
        const objs = o.$rt.ctx.objs;
        if (o.$pid && (objs && typeof objs.has === 'function' ? !objs.has(o.$pid) : o.$par && o.$par.ClassName === undefined)) { kill(o); return false; }
        return true;
      }
      function kill(o){ if (o.$dead) return; o.$dead = true; TICK.delete(o); if (o.$cos) for (const c of [...o.$cos]) c.done = true; callMsg(o, 'OnDisable'); callMsg(o, 'OnDestroy'); }
      function callRaw(o, js, a){
        const rt = o.$rt;
        if (rt.ctx.setCurrent) rt.ctx.setCurrent(rt.name);
        try { const r = o[js](...a); if (r && typeof r.next === 'function' && typeof r.throw === 'function') coRun(r, rt, o); }
        catch (e) { if (!(e && e.$exit)) rt.rep(e); }
      }
      function callMsg(o, n, args){ const m = o.$m && o.$m[n]; if (m) callRaw(o, m[2], (args || []).slice(0, m[0])); }
      function wire(o){
        const m = o.$m, p = o.$par;
        if (m.Update || m.LateUpdate || m.FixedUpdate) { TICK.add(o); nextFrame(() => {}); }
        const hit = (mt, h, pl) => mt[0] >= 2 ? [h, pl] : mt[1] === 'Player' ? [pl] : [h];
        const hook = (sig, names, args) => {
          const ns = names.filter(n => m[n]); if (!ns.length) return;
          const s = p && p !== env.workspace && typeof p.__id === 'string' ? p[sig] : null;
          if (!s || typeof s.Connect !== 'function') { o.$rt.ctx.error(ns[0].replace(/^On/, 'on') + ': положи скрипт внутрь детали — её касания и клики придут сюда', 0); return; }
          s.Connect((...a) => { if (!alive(o) || o.enabled === false) return; for (const n of ns) callRaw(o, m[n][2], args(m[n], ...a)); });
        };
        hook('Touched', ['OnTouched', 'OnTriggerEnter', 'OnCollisionEnter'], hit);
        hook('TouchEnded', ['OnTouchEnded', 'OnTriggerExit', 'OnCollisionExit'], hit);
        hook('Clicked', ['OnClicked', 'OnMouseDown'], (mt, pl) => mt[0] ? [pl] : []);
        if (m.OnPlayerAdded && env.Players) { env.Players.PlayerAdded.Connect(pl => { if (alive(o)) callMsg(o, 'OnPlayerAdded', [pl]); }); if (o.$rt.late) for (const pl of env.Players.GetPlayers()) callMsg(o, 'OnPlayerAdded', [pl]); }
        if (m.OnPlayerRemoving && env.Players) env.Players.PlayerRemoving.Connect(pl => { if (alive(o)) callMsg(o, 'OnPlayerRemoving', [pl]); });
      }
      // ── ошибки: строка Java по стеку (//# sourceURL=d37java-N.js) и понятный текст ──
      let LB = 0, CB = 0, FF = false;
      try {
        const o = {}; new Function('$', '$.e = new Error("p");\n//# sourceURL=d37java-0.js')(o);
        const st = String(o.e.stack), mm = /d37java-0\.js:(\d+):(\d+)/.exec(st) || ((FF = true) && /> Function:(\d+):(\d+)/.exec(st));
        if (mm) { LB = +mm[1]; CB = +mm[2] - 7; } else FF = false;
      } catch (e) {}
      if (Error.stackTraceLimit < 60) Error.stackTraceLimit = 60;
      function lineOf(rt, e){
        if (!LB) return 0;
        const st = String(e && e.stack || ''), re = FF ? /> Function:(\d+):(\d+)/g : new RegExp('d37java-' + rt.id + '\\.js:(\\d+):(\\d+)', 'g');
        let mm, best = 0;
        while ((mm = re.exec(st))) { const L = mapLine(rt.map, +mm[1] - LB + 1, +mm[2] - CB); if (L) { best = L; break; } }
        return best;
      }
      const RUS = { ArithmeticException: '', NullPointerException: '', ArrayIndexOutOfBoundsException: '', StackOverflowError: '' };
      function jmsg(e){
        if (e == null) return 'null';
        if (typeof e !== 'object') return jstr(e);
        if (e instanceof Throwable) { const n = (e.constructor.$q || e.constructor.name || 'Exception'), m = e.getMessage(); void RUS; return m != null && m !== '' ? n + ': ' + m : n; }
        const x = exc(e); return x instanceof Throwable ? jmsg(x) : String(e.message || e);
      }
      function report(rt, e){
        try { if (e && typeof e === 'object') { if (e.$rep) return; Object.defineProperty(e, '$rep', { value: true, configurable: true }); } } catch (x) {}
        const line = lineOf(rt, e && e.$js || e) || lineOf(rt, e), msg = jmsg(e), key = line + '|' + msg, t = Date.now();
        if (rt.seen.has(key) && t - rt.seen.get(key) < 5000) return;
        rt.seen.set(key, t);
        rt.ctx.error(msg, line);
      }
      RT = { env, mode: MODE, V3B, H, A, EX, JScript, mkScript, start, Throwable, errOut: s => (env.warn || env.print)(s), TIME, coRun, jstr, LIBCLS };
      // ── $ одного скрипта: печать (своя строка для System.out.print), Script-класс, глобальные имена ──
      function mkScript(id, map, env2, ctx, late){
        const rt = Object.create(H);
        Object.assign(rt, { id, map, ctx, name: ctx.name, env: env2, scr: env2.script, seen: new Map(), late: !!late });
        let buf = '', bufT = null;
        const emit = (s, warn) => { const f = warn ? (env2.warn || env2.print) : env2.print; if (typeof f === 'function') f(String(s).slice(0, 2000)); };
        const flush = () => { bufT = null; if (buf !== '') { const b = buf; buf = ''; emit(b); } };
        const ps = warn => ({
          println(s){ if (warn) { if (buf) flush(); emit(s, true); return; } const all = buf + s; buf = ''; if (bufT) { clearTimeout(bufT); bufT = null; } for (const l of all.split('\n')) emit(l); },
          print(s){ if (warn) { emit(s, true); return; } buf += s; const k = buf.lastIndexOf('\n'); if (k >= 0) { const lines = buf.slice(0, k).split('\n'); buf = buf.slice(k + 1); for (const l of lines) emit(l); } if (buf && !bufT) bufT = setTimeout(flush, 0); },
          printf(f, a, t){ this.print(jformat(f, a, t)); return this; }, format(f, a, t){ return this.printf(f, a, t); }, flush(){ if (!warn) flush(); }, close(){},
          toString(){ return 'java.io.PrintStream@' + hex(ih(this)); },
        });
        rt.out = s => emit(s);
        rt.rep = function (e){ report(rt, e); };
        rt.gprint = (...a) => emit(a.join(' '));
        rt.gwarn = (...a) => emit(a.join(' '), true);
        rt.exit = () => { const e = new Error('System.exit'); e.$exit = true; throw e; };
        const A2 = Object.create(A);
        A2.System = { out: ps(false), err: ps(true), arraycopy(s, sp, d, dp, n){ if (s == null || d == null) throw npe('arraycopy'); if (sp < 0 || dp < 0 || n < 0 || sp + n > s.length || dp + n > d.length) throw aioobe(sp + n > s.length ? sp + n : dp + n, sp + n > s.length ? s.length : d.length); const t = Array.prototype.slice.call(s, sp, sp + n); for (let i = 0; i < n; i++) d[dp + i] = t[i]; }, identityHashCode: x => ih(x) };
        rt.A = A2;
        rt.G = MODE === 'mod' ? Object.assign({}, env2.script, MCG ? MCG(env2, rt) : {}) : { script: env2.script, workspace: env2.workspace, game: env2.game, Game: env2.Game || env2.game, Camera: env2.Camera, Weather: env2.Weather, Support: env2.Support, Fire: env2.Fire, task: env2.task, gui: env2.gui, sound: env2.sound, Enum: env2.Enum,
          Instance: env2.Instance, Color3: env2.Color3, TweenService: env2.TweenService, TweenInfo: env2.TweenInfo, RunService: env2.RunService, Players: env2.Players, Debris: env2.Debris, BrickColor: env2.BrickColor, CFrame: env2.CFrame, random: env2.random };
        if (MODE === 'mod' && MCA) Object.assign(A2, MCA(env2, rt));
        const Sc = class extends JScript {};
        Object.defineProperty(Sc.prototype, '$rt', { value: rt });
        rt.Script = Sc;
        return rt;
      }
      function start(mod, rt){
        const insts = [];
        for (const [Cls, , meta] of mod.scripts) {
          let o;
          CUR = rt;
          try { o = new Cls(-1); } catch (e) { rt.rep(e); continue; } finally { CUR = null; }
          Object.defineProperty(o, '$m', { value: meta });
          insts.push(o);
        }
        for (const o of insts) callMsg(o, 'Awake');
        if (mod.main) { if (rt.ctx.setCurrent) rt.ctx.setCurrent(rt.name); try { const r = mod.main(); if (r && typeof r.next === 'function' && typeof r.throw === 'function') coRun(r, rt, null); } catch (e) { if (!(e && e.$exit)) rt.rep(e); } }
        for (const o of insts) callMsg(o, 'OnEnable');
        for (const o of insts) callMsg(o, 'Start');
        for (const o of insts) wire(o);
        if (MODE === 'mod' && MCSTART) MCSTART(mod, rt);
      }
      return RT;
    }
    function mapLine(map, L, C){   // строка:столбец JS → строка Java
      for (let i = Math.min(L, map.length) - 1; i >= 0; i--) {
        const row = map[i];
        if (!row || !row.length) continue;
        if (i === L - 1) { let best = 0; for (const [c, l] of row) if (c <= C - 1) best = l; if (best) return best; continue; }
        return row[row.length - 1][1];
      }
      return 0;
    }
    // фасад модов Fabric / Forge (раздел 7) подключает сюда свои части
    let MCG = null, MCA = null, MCSTART = null;
    //@@JAVA_MC@@
    // ═══ 8. Запуск: D37Lang.java.run(код, env, ctx) — один раз на скрипт (как Lua: env.script — объект скрипта или API мода) ═══
    // классы общие для всех Java-скриптов запуска (как одна программа): XC — для перевода, XR — сами классы
    const XC = new Map(), XR = new Map(), WAITQ = [];
    let NRUN = 0, waitOn = false;
    function modeOf(env){ return env && env.script && env.script.mod && env.script.world && !env.workspace ? 'mod' : 'studio'; }
    function run(code, env, ctx){
      boot(env, ctx);
      let C;
      try { C = compile(code, XC, modeOf(env)); }
      catch (e) {
        if (e && e.java && e.unk) { WAITQ.push([code, env, ctx]); if (!waitOn) { waitOn = true; Promise.resolve().then(flushWait); } return; }   // класс из скрипта ниже — переведём после всех
        report0(ctx, e); return;
      }
      startC(C, env, ctx, false);
    }
    function report0(ctx, e){ if (e && e.java) ctx.error(e.message, e.line); else ctx.error('Ошибка переводчика Java: ' + String(e && e.message || e), 0); }
    function startC(C, env, ctx, late){
      const R = boot(env, ctx);
      for (const [n, info] of C.types) XC.set(n, info);
      const id = ++NRUN, rt = R.mkScript(id, C.map, env, ctx, late);
      let mod;
      try { mod = new Function('$', C.js + '\n//# sourceURL=d37java-' + id + '.js')(rt); }
      catch (e) { if (e instanceof SyntaxError) ctx.error('Java: переводчик собрал неверный код (сообщи разработчику): ' + e.message, 0); else rt.rep(e); return; }
      for (const n of Object.keys(mod.classes || {})) XR.set(n, mod.classes[n]);
      R.start(mod, rt);
    }
    function flushWait(){
      waitOn = false;
      let list = WAITQ.splice(0), more = true;
      while (more && list.length) {
        more = false;
        const rest = [];
        for (const w of list) { let C; try { C = compile(w[0], XC, modeOf(w[1])); } catch (e) { if (e && e.java && e.unk) { rest.push(w); continue; } report0(w[2], e); more = true; continue; } more = true; startC(C, w[1], w[2], true); }
        list = rest;
      }
      for (const w of list) { try { compile(w[0], XC, modeOf(w[1])); } catch (e) { report0(w[2], e); } }
    }
    globalThis.D37Lang = globalThis.D37Lang || {};
    globalThis.D37Lang.java = { run, compile: (code, mode) => compile(code, null, mode), mapLine, rt: () => RT, lib: mode => lib(mode || 'studio'),
      registry: typeof REGISTRY === 'function' ? REGISTRY : null, _test: { lex, parse, dstr, fstr, fixedJ } };
  }

  //@@JAVA_PAGE@@
  // ═══ Примеры (как в Roblox: «вставь и поменяй») и задание для ИИ ═══
  const EXAMPLES = [
    ['Монетка: +1 очко и исчезает', `// Положи этот скрипт в деталь-монетку
Part coin = script.Parent;

coin.Touched.Connect((hit, player) -> {
    if (player == null) return;
    player.AddStat("Монеты", 1);
    sound.play("coin");
    coin.Destroy();
});`],
    ['Лава: касание — смерть', `// Положи в красную деталь (материал «Неон»)
script.Parent.Touched.Connect((hit, player) -> {
    if (player != null) player.Humanoid.Health = 0;
});`],
    ['Дверь: [E] открыть / закрыть', `// Положи в деталь-дверь
Part door = script.Parent;
Vector3 closed = door.Position;
boolean open = false;

door.Prompt("Открыть дверь").Triggered.Connect(player -> {
    open = !open;
    Vector3 to = open ? closed.add(new Vector3(0, door.Size.Y, 0)) : closed;
    TweenService.Create(door, new TweenInfo(0.6), Map.of("Position", to)).Play();
    sound.play(open ? "door_wood_open" : "door_wood_close");
});`],
    ['Движущаяся платформа (TweenService)', `// Платформа ездит туда-сюда, игрок едет на ней
Part p = script.Parent;
// 3 секунды, плавно, повторять всегда (-1) и ехать обратно (true)
TweenInfo info = new TweenInfo(3, Enum.EasingStyle.Sine, null, -1, true);
TweenService.Create(p, info, Map.of("Position", p.Position.add(new Vector3(0, 0, 12)))).Play();`],
    ['Крутилка: класс extends Script, update()', `public class Spinner extends Script {
    public double speed = 90;   // градусов в секунду

    @Override
    public void update(double dt) {
        Vector3 r = Parent.Orientation;
        Parent.Orientation = new Vector3(r.X, (r.Y + speed * dt) % 360, r.Z);
    }
}`],
    ['Шипы: onTouched в классе', `public class Spikes extends Script {
    int damage = 25;
    double lastHit = -10;

    public void onTouched(Part hit, Player player) {
        if (player == null || time() - lastHit < 1) return;   // не чаще раза в секунду
        lastHit = time();
        player.Humanoid.TakeDamage(damage);
        player.Message("Ай! −" + damage + " здоровья", 1);
    }
}`],
    ['Мигалка: wait() в цикле', `public class Blinker extends Script {
    public void start() {
        while (true) {
            Parent.Transparency = 0.8;
            wait(0.5);              // ждём полсекунды — игра не замирает
            Parent.Transparency = 0;
            wait(0.5);
        }
    }
}`],
    ['Кнопка-ловушка: пол исчезает на 3 секунды', `// Положи в деталь-кнопку. Рядом — деталь «Пол»
Part floor = workspace.FindFirstChild("Пол", true);

script.Parent.Prompt("Нажать").Triggered.Connect(player -> {
    if (floor == null) return;
    floor.Transparency = 0.7;
    floor.CanCollide = false;      // пол исчез на 3 секунды
    wait(3);
    floor.Transparency = 0;
    floor.CanCollide = true;
});`],
    ['При входе: приветствие и очки', `// Положи в Workspace (без родителя)
Players.PlayerAdded.Connect(player -> {
    player.SetStat("Монеты", 0);
    player.Message("Привет, " + player.Name + "! Собери все монетки 🪙", 4);
});`],
    ['Финиш: таймер и рекорд', `// Положи в деталь «Финиш»
boolean done = false;

script.Parent.Touched.Connect((hit, player) -> {
    if (player == null || done) return;
    done = true;
    double t = time();
    gui.message(String.format("🏁 %s прошёл за %.1f с!", player.Name, t), 5);
    player.SetStat("Время", Math.round(t * 10) / 10.0);
    sound.play("coin");
});`],
    ['Таблица лидеров: record, список, сортировка', `// Положи в деталь-табло: клик — показать тройку лучших
record Entry(String name, int coins) {}

script.Parent.Clicked.Connect(player -> {
    List<Entry> board = new ArrayList<>();
    for (Player p : Players.GetPlayers()) board.add(new Entry(p.Name, (int) p.GetStat("Монеты")));
    board.sort(Comparator.comparingInt(Entry::coins).reversed());
    StringBuilder sb = new StringBuilder("🏆");
    for (int i = 0; i < Math.min(3, board.size()); i++)
        sb.append(" ").append(i + 1).append(". ").append(board.get(i).name()).append(" — ").append(board.get(i).coins());
    gui.message(sb.toString(), 5);
});`],
    ['Лестница из блоков (как в Minecraft)', `// Строит лестницу из 10 блоков от детали со скриптом
Part base = script.Parent;
for (int i = 0; i < 10; i++) {
    Part block = Instance.create("Part", workspace);
    block.Size = new Vector3(4, 1, 4);
    block.Position = base.Position.add(new Vector3(0, i + 1, i * 4));
    block.Color = Color3.fromHSV(i / 10.0, 0.7, 1);
    block.Material = "grass";
    wait(0.1);   // строится на глазах
}`],
  ];
  const AI = `Напиши скрипт на Java для «Студии 3D» сайта dan4ik37 (как Roblox Studio; Java переводится в JavaScript прямо в браузере, без JVM — поэтому используй только то, что перечислено).
Два стиля (выбери один):
1) Код верхнего уровня (как JShell или «компактные файлы» Java 25): инструкции, поля и методы прямо в файле, без класса. script.Parent — объект, в котором лежит скрипт. Пример: script.Parent.Touched.Connect((hit, player) -> { if (player != null) { player.AddStat("Монеты", 1); script.Parent.Destroy(); } });
2) Класс: public class Имя extends Script { … } с методами start(), update(double dt), onTouched(Part hit, Player player), onTouchEnded(Part hit, Player player), onClicked(Player player), onPlayerAdded(Player player). Внутри: Parent (деталь со скриптом), wait(сек), delay(сек, () -> …), destroy().
Ожидание: wait(секунды) и Thread.sleep(миллисекунды) работают везде, даже в обработчиках событий, — игра при этом не замирает.
Мир (имена как в Roblox): workspace.FindFirstChild("Имя", true), Instance.create("Part", workspace), деталь.Clone(), деталь.Destroy(), деталь.GetChildren(); свойства детали — это поля (не геттеры): Name, Position, Size, Orientation (Vector3, градусы), Color (Color3.fromRGB(255, 0, 0), Color3.fromHSV(h, s, v)), Material ("plastic", "neon", "wood", "glass", "metal", "brick", "grass", "sand", "ice" или Enum.Material.Neon), Transparency (0–1), CanCollide, Anchored (false — деталь падает).
Vector3: new Vector3(x, y, z), поля X, Y, Z, Magnitude, Unit; методы add, sub, mul(число), div, Dot, Cross, Lerp; Vector3.up, Vector3.zero (операторов + и - для векторов в Java нет).
События — Connect с лямбдой: деталь.Touched.Connect((hit, player) -> …); деталь.TouchEnded; деталь.Clicked.Connect(player -> …); деталь.Prompt("Текст").Triggered.Connect(player -> …); RunService.Heartbeat.Connect(dt -> …); Players.PlayerAdded.Connect(player -> …). Connect возвращает соединение: .Disconnect().
Игрок: player.Name, player.Position, player.Humanoid.Health / MaxHealth (100) / WalkSpeed (16) / JumpPower (50), player.Humanoid.TakeDamage(n), player.Teleport(new Vector3(x, y, z)), player.SetStat("Имя", число) / AddStat / GetStat (таблица очков), player.Message("текст", секунды).
Плавно: TweenService.Create(деталь, new TweenInfo(секунды, Enum.EasingStyle.Sine, null, повторы (-1 — всегда), обратно (true/false)), Map.of("Position", v, "Transparency", 0.5)).Play().
Ещё можно: System.out.println, String.format, Math, new Random(), time() (секунды с начала игры), task.delay(сек, () -> …), gui.message("текст", сек), gui.text("ключ", "текст"), sound.play("coin" | "jump" | "hit" | "click" | "pickup" | "buzz" | "door_wood_open" | "door_wood_close" | "break"); java.util (ArrayList, HashMap, HashSet, TreeMap, ArrayDeque, List.of, Map.of, Collections, Arrays, Optional), стримы, лямбды, record, enum, switch со стрелками, var. import писать не обязательно.
Режим игры и камера: Game.Mode ("obby", "race", "ffa", "teams", "koth", "hide", "coins", "survival" или ""), Game.State, Game.Round, Game.TimeLeft, Game.RoundStart.Connect(r -> …), Game.RoundEnd.Connect((winner, text) -> …), Game.AddScore(player, n), Game.GetScore(player), Game.GetTeam(player), Game.EndRound(player); Camera.Mode = "third" | "first" | "shoulder" | "top" | "iso" | "side" | "fixed", Camera.SetMode("top", player), Camera.Shake(сила, сек). Погода: Weather.State ("clear", "rain", "snow", "thunderstorm"…), Weather.Season ("spring", "summer", "autumn", "winter"), Weather.Temperature, Weather.FeelsLike, Weather.Today (праздник), Weather.Changed.Connect((state, season) -> …), Weather.Holiday.Connect((id, text) -> …), Weather.Set("snow"). Прочность (если включено обрушение): Support.Mode, Support.Holds(part), Support.Get(part) (0…100), Support.Break(part), Support.Collapsed.Connect(part -> …). Огонь: Fire.Ignite(part), Fire.Extinguish(part), Fire.IsBurning(part), Fire.Count, Fire.Ignited / Fire.Burnt / Fire.Extinguished.Connect(part -> …).
Нельзя: Thread (кроме Thread.sleep) и synchronized, файлы (java.io, java.nio), сеть, рефлексия, Scanner (ввода нет), Swing/AWT, классы Minecraft (они — для модов «Кубомира» и «Подземья»).
Задача: `;
  const DEF = { label: 'Java (как в модах Minecraft)', short: 'Java', icon: '☕', kind: 'text', worker, examples: EXAMPLES, ai: AI,
    placeholder: '// Java. script.Parent — объект, в котором лежит скрипт.\n// Нажми «📚 Примеры», чтобы вставить готовый.' };
  if (typeof E.lang === 'function') E.lang('java', DEF);
  else { E.langs = E.langs || {}; E.langs.java = Object.assign({ id: 'java' }, DEF); }
})();

// Тесты Lua для «Студии 3D» (js/engine/lang-lua.js): язык (Lua 5.1 + Luau) и скрипты как в Roblox через runtime() песочницы.
// Запуск из корня сайта: node scripts/lang-lua-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/script.js'), 'utf8'), { filename: 'script.js' });
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/lang-lua.js'), 'utf8'), { filename: 'lang-lua.js' });
delete globalThis.window;
const E = globalThis.D37E;
const LIB = '(' + E.langs.lua.worker.toString() + ')();';
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : '\n   ' + String(extra).split('\n').join('\n   ')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═══ Язык: отдельная песочница только с Lua ═══
const core = vm.createContext({ setTimeout, clearTimeout, console });
vm.runInContext(LIB, core);
const L = core.D37Lang.lua;
const out = [], errs = [];
const env = { print: s => out.push(s), warn: s => out.push('W:' + s) };
const ctxT = { name: 'T', error: (m, l) => errs.push(l + ': ' + m), setCurrent(){} };
function lua(code){
  out.length = 0; errs.length = 0;
  L.run(code, env, ctxT);
  return out.join('\n') + (errs.length ? (out.length ? '\n' : '') + 'ERR ' + errs.join(' | ') : '');
}
function same(name, code, want){ const got = lua(code); ok(got === want, name, 'ждали: ' + JSON.stringify(want) + '\nвышло: ' + JSON.stringify(got)); }
function like(name, code, re){ const got = lua(code); ok(re.test(got), name, 'шаблон: ' + re + '\nвышло: ' + JSON.stringify(got)); }

// ── числа и печать ──
same('печать чисел как в Lua', 'print(1, 2.5, -0.0, 1e15, 1e14, 123456789012, 0.1 + 0.2, 1/0, -1/0, 2^53, 1e100, 5e-324 > 0)', '1 2.5 -0 1e+15 1e+14 123456789012 0.3 inf -inf 9.007199254741e+15 1e+100 true');
same('tostring', 'print(tostring(nil), tostring(true), tostring(12), tostring("a"), tostring(-7.25), math.pi)', 'nil true 12 a -7.25 3.1415926535898');
same('арифметика', 'print(1 + 2, 10 / 4, 2^10, 7 // 2, -7 // 2, -7 % 3, 7 % -3, 5.5 // 2, 2^-1)', '3 2.5 1024 3 -4 2 -2 2 0.5');
same('строки в арифметике', 'print("10" + 5, "3" * "4", "0x10" + 0, " 2 " * 2, 10 .. "")', '15 12 16 4 10');
same('склейка чисел', 'print(1 .. 2, 1.5 .. "", -0.0 .. "", 2^63 .. "")', '12 1.5 -0 9.2233720368548e+18');
same('литералы Luau', 'print(1_000_000, 0xFF, 0b1010, 0x7fffffff, .5, 3., 1e2)', '1000000 255 10 2147483647 0.5 3 100');
same('деление на ноль и nan', 'print(1/0, -1/0, 0/0 ~= 0/0, math.huge == 1/0)', 'inf -inf true true');
// ── логика и сравнение ──
same('and/or/not', 'print(nil and 1, false or "x", 1 and 2, nil or false, false and nil, not nil, not 0, not not nil)', 'nil x 2 false false true false false');
same('равенство', 'print(10 == "10", 0 == -0, 1 == 1.0, {} == {}, nil == false, "a" == "a")', 'false true true false false true');
same('сравнение строк', 'print("a" < "b", "abc" < "abd", "Z" < "a", "" < "a", "b" >= "a")', 'true true true true true');
like('сравнение разных типов — ошибка', 'print(pcall(function() return 1 < "2" end))', /^false T:1: попытка сравнить number и string$/);
// ── строки ──
same('длинные строки и комментарии', '--[[ комментарий\nещё ]] print([[line1\nline2]], [==[a]]b]==]) -- хвост', 'line1\nline2 a]]b');
same('escape-последовательности', 'print("a\\tb\\\\c\\"d\\65\\x41\\u{48}\\z\n      e")', 'a\tb\\c"dAAHe');
same('методы строк', 'local s = "Hello" print(s:len(), s:lower(), s:upper(), s:find("l"), ("abc"):reverse(), #s)', '5 hello HELLO 3 cba 5');
same('sub', 'print(("hello"):sub(2, -2), ("hello"):sub(-3), ("hello"):sub(0), ("hello"):sub(4, 100), "[" .. ("hello"):sub(3, 2) .. "]", ("hello"):sub(-100, 2))', 'ell llo hello lo [] he');
same('rep, byte, char', 'print(string.rep("ab", 3, "-"), "[" .. ("x"):rep(0) .. "]", string.byte("A"), string.byte("abc", 1, -1), string.char(72, 105))', 'ab-ab-ab [] 65 97 Hi');
same('find', 'print(string.find("hello world", "o w"), string.find("hello", "l+"), string.find("a.b", ".", 1, true), string.find("abc", "x"), ("abc"):find("b", -1), ("abc"):find("", 10))', '5 3 2 nil nil nil');
same('find с захватами', 'print(string.find("key = val", "(%w+) = (%w+)"))', '1 9 key val');
same('match', 'print(string.match("key=value", "(%w+)=(%w+)"), string.match("  trim  ", "^%s*(.-)%s*$"), string.match("2024-01-05", "(%d+)-(%d+)-(%d+)"))', 'key trim 2024 01 05');
same('match: позиции, %b, обратные ссылки', 'print(string.match("hello", "()ll()"), string.match("x(a(b)c)y", "%b()"), string.match(\'say "hi" now\', "([\\"\'])(.-)%1"))', '3 (a(b)c) " hi');
same('наборы и классы', 'print(string.match("abc123", "[%a]+"), string.match("x-y", "[a-z%-]+"), string.match("Hello", "[^%l]"), string.match("a1_b", "[%w_]+"), string.match("  x", "%S"), string.match("A-Z", "[A-Z]-"))', 'abc x-y H a1_b x ');
same('якоря и ?', 'print(("abc"):match("^b"), ("abc"):match("c$"), ("color"):match("colou?r"), ("colour"):match("colou?r"), ("aaa"):match("a-"), ("aaa"):match("a-$"))', 'nil c color colour  aaa');
same('gmatch', 'local t = {} for w in string.gmatch("one two three", "%a+") do t[#t+1] = w end print(table.concat(t, ","))\nfor k, v in ("a=1, b=2"):gmatch("(%w+)=(%w+)") do print(k, v) end', 'one,two,three\na 1\nb 2');
same('gsub: строка', 'print(string.gsub("hello world", "o", "0"))\nprint(string.gsub("hello", "", "-"))\nprint(string.gsub("abc", "%w", "%0%0"))\nprint(("x = 1, y = 2"):gsub("(%w+) = (%w+)", "%2 = %1"))', 'hell0 w0rld 2\n-h-e-l-l-o- 6\naabbcc 3\n1 = x, 2 = y 2');
same('gsub: таблица, функция, n, ^', 'print(string.gsub("$name is $age", "%$(%w+)", {name = "Bob", age = 42}))\nprint(string.gsub("1 2 3", "%d", function(d) return d * 2 end))\nprint(string.gsub("aaa", "a", "b", 2))\nprint(string.gsub("aaa", "^a", "b"))\nprint(string.gsub("abc", "b", function() return nil end))\nprint(("50"):gsub("%d+", "%0%%"))', 'Bob is 42 2\n2 4 6 3\nbba 2\nbaa 1\nabc 1\n50% 1');
same('%f (граница слова)', 'print(string.gsub("THE (quick) fox", "%f[%a]%a+", "W"))', 'W (W) W 3');
like('ошибка в шаблоне', 'print(pcall(string.find, "abc", "[a"))', /^false неверный шаблон/);
same('format: числа', 'print(string.format("%5.2f|%d|%s|%x|%X|%o|%e|%g|%-5s|%05d|%+d|%3d|%-3d|%.3s|%%|%c", 3.14159, 42, "hi", 255, 255, 8, 12345.678, 0.0001, "ab", 42, 5, 5, 5, "abcdef", 65))', ' 3.14|42|hi|ff|FF|10|1.234568e+04|0.0001|ab   |00042|+5|  5|5  |abc|%|A');
same('format: %g и %d', 'print(string.format("%.14g", 0.1), string.format("%g", 1e20), string.format("%g", 123456789), string.format("%d", 3.7), string.format("%5.1f", -3.14159), string.format("% d", 5), string.format("%#x", 255), string.format("%.3d", 7))', '0.1 1e+20 1.23457e+08 3  -3.1  5 0xff 007');
same('format: %q и %s с таблицей', 'print(string.format("%q", "a\\"b\\n"))\nprint(string.format("%s|%s", nil, setmetatable({}, {__tostring = function() return "T!" end})))', '"a\\"b\\\n"\nnil|T!');
same('split и интерполяция', 'local parts = ("a,b,,c"):split(",") print(#parts, parts[3] == "", parts[4])\nlocal name, n = "Bob", 3 print(`Hi {name}, you have {n * 2} coins`, `{"nested"} {`{n}`}`, `plain`, `a \\{b\\} c`)', '4 true c\nHi Bob, you have 6 coins nested 3 plain a {b} c');
same('Color3-строка: .R и :Lerp', 'local c = "#ff8000" print(c.R, c.G, c.B, c:Lerp("#000000", 0.5), c:ToHex())', '1 0.50196078431373 0 #804000 ff8000');
// ── таблицы ──
same('длина и дырки', 'local t = {} t[1] = "a" t[2] = "b" t[4] = "d" print(#t) t[3] = "c" print(#t) print(#{1, 2, 3, nil, 5}, #{n = 1}, #{nil, nil})', '2\n4\n5 0 0');
same('ключи-числа', 'local t = {} t[1.0] = "a" t[2] = "b" print(t[1], #t, t[2.0]) t[1.5] = "x" print(t[1.5]) local k = {} t[k] = "obj" print(t[k])', 'a 2 b\nx\nobj');
same('insert/remove/concat', 'local t = {1, 2, 3} table.insert(t, 4) table.insert(t, 1, 0) print(table.concat(t, ",")) print(table.remove(t), table.remove(t, 1), table.concat(t, ","), table.remove({}))', '0,1,2,3,4\n4 0 1,2,3');
same('sort', 'local t = {5, 2, 8, 1} table.sort(t) print(table.concat(t, " ")) table.sort(t, function(a, b) return a > b end) print(table.concat(t, " "))\nlocal p = {{n="b"}, {n="c"}, {n="a"}} table.sort(p, function(x, y) return x.n < y.n end) print(p[1].n, p[2].n, p[3].n)\nlocal s = {"pear", "apple", "fig"} table.sort(s) print(table.concat(s, " "))', '1 2 5 8\n8 5 2 1\na b c\napple fig pear');
same('unpack/select/pack', 'print(select("#", 1, nil, 3), select(2, "a", "b", "c"), select(-1, "a", "b"))\nprint(unpack({1, 2, 3}))\nprint(table.unpack({1, 2, 3}, 2))\nlocal p = table.pack(1, nil, 3) print(p.n, p[1], p[2], p[3])\nprint(select("#", table.unpack({1, nil, 3})))', '3 b b\n1 2 3\n2 3\n3 1 nil 3\n3');
same('find/clear/clone/create/freeze', 'local t = {5, 6, 7} print(table.find(t, 6), table.find(t, 9)) local c = table.clone(t) table.clear(t) print(#t, #c)\nlocal f = table.freeze({1}) print(pcall(function() f[1] = 2 end)) print(table.isfrozen(f), #table.create(3, "x"))', '2 nil\n0 3\nfalse T:2: попытка изменить таблицу только для чтения (table.freeze)\ntrue 3');
same('pairs: сначала массив, потом поля по порядку', 'local t = {1, 2, a = "x", b = "y"} for k, v in pairs(t) do print(k, v) end', '1 1\n2 2\na x\nb y');
same('next и удаление при обходе', 'local t = {a = 1} print(next(t)) print(next(t, "a")) print(next({}))\nlocal u = {a=1, b=2, c=3} for k in pairs(u) do u[k] = nil end print(next(u))', 'a 1\nnil\nnil\nnil');
same('for по таблице (Luau)', 'local t = {10, 20, x = 1} local n, s = 0, 0 for k, v in t do n += 1 s += v end print(n, s)', '3 31');
same('ipairs до первой дырки', 'local t = {1, 2, nil, 4} local n = 0 for i, v in ipairs(t) do n = i end print(n)', '2');
same('конструктор: [k]= и позиции', 'local t = {[1] = "x", "y", [3] = "z", n = 2} print(t[1], t[3], t.n, #t)', 'y z 2 1');
// ── функции, varargs, замыкания ──
same('varargs', 'local function f(...) return select("#", ...), ... end print(f(1, nil, 3))\nlocal function g(...) local a, b = ... return a, b end print(g(5))\nlocal function h(...) return {...} end print(#h(1, 2, 3))\nlocal function k(...) return ... end print(k())', '3 1 nil 3\n5 nil\n3\n');
same('несколько значений', 'local function mr() return 1, 2, 3 end print(mr()) print((mr())) local t = {mr(), mr()} print(#t) local a, b, c, d = mr() print(a, b, c, d) print(mr(), 10)', '1 2 3\n1\n4\n1 2 3 nil\n1 10');
same('присваивание нескольких', 'local a, b = 1, 2 a, b = b, a print(a, b) local t = {1, 2} local i = 1 i, t[i] = i + 1, 20 print(i, t[1], t[2])', '2 1\n2 20 2');
same('замыкания в циклах', 'local fs = {} for i = 1, 3 do fs[i] = function() return i end end print(fs[1](), fs[2](), fs[3]())\nlocal g = {} local j = 0 while j < 3 do j = j + 1 local k = j g[j] = function() return k end end print(g[1](), g[3]())\nlocal h = {} for _, v in ipairs({"a", "b"}) do h[#h + 1] = function() return v end end print(h[1](), h[2]())', '1 2 3\n1 3\na b');
same('общие внешние переменные', 'local function counter() local c = 0 return function() c = c + 1 return c end end local c1 = counter() c1() print(c1(), counter()())', '2 1');
same('рекурсия', 'local function fib(n) if n < 2 then return n end return fib(n-1) + fib(n-2) end print(fib(20))', '6765');
same('тени переменных', 'local x = 1 do local x = x + 1 print(x) end print(x) local x = x * 10 print(x)', '2\n1\n10');
same('глобальные', 'gx = 5 function gf() return gx * 2 end print(gf(), rawget(getfenv(), "gx"))', '10 5');
same('методы и self', 'local obj = {n = 3} function obj:inc(d) self.n = self.n + (d or 1) return self end obj:inc():inc(5) print(obj.n) function obj.static(a) return a end print(obj.static(7))', '9\n7');
// ── циклы ──
same('числовой for', 'for i = 10, 1, -3 do print(i) end for x = 0, 1, 0.25 do print(x) end for i = 1, 0 do print("никогда") end', '10\n7\n4\n1\n0\n0.25\n0.5\n0.75\n1');
same('переменная цикла — копия', 'for i = 1, 3 do print(i) i = 10 end', '1\n2\n3');
same('repeat видит локальные тела', 'local i = 0 repeat local j = i i = i + 1 until j >= 2 print(i)', '3');
same('break и continue', 'for i = 1, 5 do if i == 2 then continue end if i == 4 then break end print(i) end', '1\n3');
same('continue в repeat и while', 'local i = 0 repeat i += 1 if i % 2 == 0 then continue end print(i) until i >= 5\nlocal j = 0 while j < 5 do j += 1 if j == 3 then continue end io_ = j end print(io_)', '1\n3\n5\n5');
same('continue как имя', 'local continue = 5 print(continue + 1)', '6');
like('шаг 0 — ошибка', 'for i = 1, 2, 0 do end', /ERR 1: цикл for: шаг не может быть 0/);
// ── синтаксис Luau ──
same('составное присваивание', 'local x = 5 x += 2 x -= 1 x *= 3 x /= 2 x //= 2 x %= 5 x ^= 2 local s = "a" s ..= "b" local t = {v = 1} t.v += 10 t["v"] *= 2 print(x, s, t.v)', '16 ab 22');
same('аннотации типов', 'type Point = {x: number, y: number}\nexport type Pair<T> = {first: T, second: T?}\nlocal function add(a: number, b: number): number return a + b end\nlocal p: Point = {x = 1, y = 2}\nlocal function id<T>(v: T): T return v end\nlocal f: (number) -> string = function(n: number): string return tostring(n) end\nlocal v = (p :: any).x\nlocal u: {[string]: number} | nil = nil\nlocal function va(...: number): ...number return ... end\nfor i: number = 1, 1 do end\nprint(add(1, 2), p.y, id("q"), f(5), v, u, va(4, 5))', '3 2 q 5 1 nil 4 5');
same('if-выражение', 'local n = 5 print(if n > 3 then "big" elseif n > 1 then "mid" else "small", if n > 9 then 1 else 2)', 'big 2');
same('type как имя функции', 'print(type(1), type("s"), type({}), type(print), type(nil), typeof(2), type(coroutine.create(function() end)))', 'number string table function nil number thread');
// ── метатаблицы ──
same('метаметоды', 'local V = {}\nV.__index = V\nV.__add = function(a, b) return V.new(a.x + b.x) end\nV.__eq = function(a, b) return a.x == b.x end\nV.__lt = function(a, b) return a.x < b.x end\nV.__le = function(a, b) return a.x <= b.x end\nV.__tostring = function(v) return "V(" .. v.x .. ")" end\nV.__len = function(v) return v.x end\nV.__call = function(self, y) return self.x + y end\nV.__concat = function(a, b) return "cat" end\nV.__unm = function(a) return V.new(-a.x) end\nV.__mul = function(a, k) return V.new(a.x * k) end\nfunction V.new(x) return setmetatable({x = x}, V) end\nfunction V:double() return self.x * 2 end\nlocal a, b = V.new(1), V.new(2)\nprint(tostring(a + b), a == V.new(1), a ~= b, a < b, a <= b, b > a, #b, a(10), a .. b, a .. "s", tostring(-a), a:double(), tostring(b * 3))', 'V(3) true true true true true 2 11 cat cat V(-1) 2 V(6)');
same('__index и __newindex', 'local p = setmetatable({}, {__index = function(t, k) return k .. "!" end, __newindex = function(t, k, v) rawset(t, k, v * 2) end})\np.a = 5\nprint(p.a, p.zz, rawget(p, "zz"))\nlocal base = {hello = "hi"} local d = setmetatable({}, {__index = base}) print(d.hello, d.nope)', '10 zz! nil\nhi nil');
same('__metatable', 'local t = setmetatable({}, {__metatable = "locked"}) print(getmetatable(t), pcall(setmetatable, t, {}))\nprint(getmetatable("x").__index == string)', 'locked false нельзя изменить защищённую метатаблицу\ntrue');
same('наследование', 'local Animal = {} Animal.__index = Animal\nfunction Animal.new(name) local self = setmetatable({}, Animal) self.name = name return self end\nfunction Animal:speak() return self.name .. " makes a sound" end\nlocal Dog = setmetatable({}, {__index = Animal}) Dog.__index = Dog\nfunction Dog.new(name) local self = Animal.new(name) return setmetatable(self, Dog) end\nfunction Dog:speak() return self.name .. " barks" end\nfunction Dog:base() return Animal.speak(self) end\nprint(Animal.new("cat"):speak(), Dog.new("rex"):speak(), Dog.new("rex"):base())', 'cat makes a sound rex barks rex makes a sound');
// ── ошибки ──
same('pcall/error', 'print(pcall(function() error("boom") end))\nlocal ok, e = pcall(function() error({code = 5}) end) print(ok, type(e), e.code)\nprint(pcall(error))\nprint(pcall(function() error("lvl0", 0) end))\nprint(pcall(function(a, b) return a + b end, 2, 3))', 'false T:1: boom\nfalse table 5\nfalse nil\nfalse lvl0\ntrue 5');
same('error уровня 2', 'local function check(x)\n  if type(x) ~= "number" then error("need number", 2) end\nend\nlocal function caller()\n  check("a")\nend\nprint(pcall(caller))', 'false T:5: need number');
same('сообщения ошибок с именами', 'print(pcall(function() local x = nil; return x.y end))\nprint(pcall(function() return 1 + nil end))\nprint(pcall(function() undefinedFn() end))\nprint(pcall(function() local t = {} t.a.b = 1 end))\nprint(pcall(function() local n = 5 return n:foo() end))\nprint(pcall(function() return #nil end))\nprint(pcall(function() return "a" .. {} end))', "false T:1: попытка взять поле 'y' у nil (локальная переменная 'x')\nfalse T:2: попытка выполнить арифметику (+) над number и nil\nfalse T:3: попытка вызвать nil (глобальная переменная 'undefinedFn')\nfalse T:4: попытка записать поле 'b' в nil (поле 'a')\nfalse T:5: попытка взять поле 'foo' у number (локальная переменная 'n')\nfalse T:6: попытка взять длину (#) у nil\nfalse T:7: попытка склеить (..) string и table — оберни значение в tostring(…)");
same('xpcall и assert', 'print(xpcall(function() error("x", 0) end, function(m) return "handled " .. m end))\nprint(pcall(assert, false, "msg"))\nprint(pcall(assert, 1, 2))\nprint(select(2, pcall(assert, nil)))\nprint(xpcall(function(a) return a * 2 end, print, 21))', 'false handled x\nfalse msg\ntrue 1 2\nassertion failed!\ntrue 42');
like('переполнение стека', 'local function r(n) return r(n + 1) + 1 end print(pcall(r, 1))', /^false T:1: переполнение стека/);
same('tonumber', 'print(tonumber("10"), tonumber("0x1F"), tonumber("ff", 16), tonumber("z", 36), tonumber("8", 8), tonumber(" 5 "), tonumber("5x"), tonumber("1e2"), tonumber(nil), tonumber("-11", 2), tonumber(""))', '10 31 255 35 nil 5 nil 100 nil -3 nil');
// ── ошибки в «Вывод» с номером строки ──
same('синтаксис: нет end', 'if x then\nprint(1)\n', 'ERR 3: ошибка в коде: ожидалось "end" (чтобы закрыть "if" со строки 1), а найдено конец кода');
same('синтаксис: незакрытая строка', 'local a = 1\nprint("abc)\n', 'ERR 2: ошибка в коде: незакрытая строка — перенос внутри кавычек (для нескольких строк пиши [[ … ]])');
same('синтаксис: подсказка != ', 'if a != b then end', "ERR 1: ошибка в коде: неожиданный символ '!=' — «не равно» в Lua пишется ~=");
same('синтаксис: лишний end', 'print(1)\nend', 'ERR 2: ошибка в коде: лишнее "end" — его нечем закрыть (проверь, нет ли лишнего end)');
same('ошибка выполнения: строка', 'local a = 1\nlocal b = nil\nprint(b.x)', "ERR 3: попытка взять поле 'x' у nil (локальная переменная 'b')");
same('error() наверху — без «T:1:»', 'print("до")\nerror("своя ошибка")', 'до\nERR 2: своя ошибка');
same('ошибка внутри функции — её строка', 'local function f()\n  local t = nil\n  return t[1]\nend\nf()', "ERR 3: попытка взять [1] у nil (локальная переменная 't')");
// ── сопрограммы ──
same('coroutine: resume/yield/status', 'local co = coroutine.create(function(a, b)\n  print("start", a, b)\n  local c = coroutine.yield(a + b)\n  print("got", c)\n  local d, e = coroutine.yield(c * 2)\n  print("got2", d, e)\n  return "done"\nend)\nprint(coroutine.resume(co, 1, 2))\nprint(coroutine.status(co))\nprint(coroutine.resume(co, 10))\nprint(coroutine.resume(co, "x", "y"))\nprint(coroutine.status(co), coroutine.resume(co))', 'start 1 2\ntrue 3\nsuspended\ngot 10\ntrue 20\ngot2 x y\ntrue done\ndead false нельзя продолжить завершённую сопрограмму');
same('coroutine.wrap и вложенный yield', 'local gen = coroutine.wrap(function() for i = 1, 3 do coroutine.yield(i) end end) print(gen(), gen(), gen())\nlocal function inner() coroutine.yield("deep") return "back" end\nlocal co = coroutine.wrap(function() local r = inner() return r end)\nprint(co(), co())', '1 2 3\ndeep back');
same('ошибка в сопрограмме', 'local co = coroutine.create(function() error("oops") end) print(coroutine.resume(co))\nlocal w = coroutine.wrap(function() error("w!", 0) end) print(pcall(w))', 'false T:1: oops\nfalse w!');
same('running/isyieldable/yield сквозь pcall', 'print(coroutine.isyieldable(), type(coroutine.running()))\nlocal co = coroutine.wrap(function() local ok, v = pcall(function() return coroutine.yield(1) + 1 end) return ok, v end)\nprint(co()) print(co(41))', 'true thread\n1\ntrue 42');
same('yield в метаметоде — понятная ошибка', 'local t = setmetatable({}, {__index = function() coroutine.yield() end}) print(pcall(function() return t.x end))', 'false T:1: здесь нельзя ждать (wait / yield): внутри метаметода, __index или __tostring');
// ── библиотеки ──
same('math', 'print(math.clamp(15, 0, 10), math.sign(-3), math.round(2.5), math.round(-2.5), math.floor(-0.5), math.sqrt(16), math.fmod(7, 3), math.fmod(-7, 3), math.modf(3.7))\nprint(math.max(1, 5, 3), math.min(4, 2), math.abs(-3), math.noise(1, 2, 3), math.log(8, 2), math.lerp(0, 10, 0.25), math.deg(math.pi))', '10 -1 3 -3 -1 4 1 -1 3 0.7\n5 2 3 0 3 2.5 180');
same('math.random с зерном', 'math.randomseed(42) local a = math.random(1, 100) math.randomseed(42) print(a == math.random(1, 100), math.random() < 1, math.random(5) <= 5) local r = Random.new(7) local x = r:NextInteger(1, 6) print(x >= 1 and x <= 6, typeof(r))', 'true true true\ntrue Random');
same('utf8 и bit32', 'print(utf8.char(72, 1087), utf8.len("привет"), #"привет", utf8.codepoint("п"))\nprint(bit32.band(0xFF, 0x0F), bit32.bor(1, 2), bit32.bxor(3, 1), bit32.lshift(1, 4), bit32.rshift(256, 4), bit32.bnot(0), bit32.extract(0xF0, 4, 4))', 'Hп 6 6 1087\n15 3 2 16 16 4294967295 15');
same('os', 'print(type(os.time()), os.date("%Y") == tostring(os.date("*t").year), os.time({year = 2020, month = 1, day = 1, hour = 0}) < os.time(), type(os.clock()), type(tick()))', 'number true true number number');
same('loadstring', 'local f = loadstring("return 1 + 2") print(f())\nlocal g, err = loadstring("return +") print(g, (err:gsub("^%[string%]:1: .*", "ok")))', '3\nnil ok');
same('_G общий, globals — свои', '_G.shared1 = 7 print(_G.shared1, shared1)', '7 nil');
// ── скорость ──
{
  let t0 = Date.now();
  const r = lua('local s = 0 for i = 1, 1e6 do s = s + i end print(s)');
  const ms1 = Date.now() - t0;
  ok(r === '500000500000' && ms1 < 3000, 'цикл 1e6 — быстро', r + ' ' + ms1 + ' мс');
  t0 = Date.now();
  const r2 = lua('local function f(x) return x + 1 end local s = 0 for i = 1, 1e6 do s = f(s) end local t = {} for i = 1, 1e5 do t[#t + 1] = i end print(s, #t)');
  const ms2 = Date.now() - t0;
  ok(r2 === '1000000 100000' && ms2 < 3000, '1e6 вызовов функции — быстро', r2 + ' ' + ms2 + ' мс');
  console.log(`  скорость: цикл 1e6 — ${ms1} мс, 1e6 вызовов + 1e5 вставок — ${ms2} мс`);
}

// ═══ wait и таймеры (асинхронно) ═══
async function timers(){
  out.length = 0; errs.length = 0;
  L.run('print("a") local dt = task.wait(0.05) print("b", dt >= 0.04) task.spawn(function() print("spawn") task.wait(0.02) print("spawn2") end) task.delay(0.03, function(x) print("delay", x) end, 9) print("c")', env, ctxT);
  ok(out.join('|') === 'a', 'wait: до ожидания', out.join('|'));
  await sleep(150);
  ok(out.join('|') === 'a|b true|spawn|c|spawn2|delay 9', 'wait, task.spawn, task.delay', out.join('|'));
  out.length = 0;
  L.run('local co = coroutine.create(function() wait(0.02) print("after wait") end) print(coroutine.resume(co)) print(coroutine.status(co))', env, ctxT);
  await sleep(80);
  ok(out.join('|') === 'true|suspended|after wait', 'wait внутри coroutine — продолжит планировщик', out.join('|'));
  out.length = 0; errs.length = 0;
  L.run('task.wait(0.01)\nlocal x = nil\nprint(x.y)', env, ctxT);
  await sleep(60);
  ok(errs.join('|') === "3: попытка взять поле 'y' у nil (локальная переменная 'x')", 'ошибка после wait — строка верная', errs.join('|'));
  out.length = 0;
  L.run('local ok, v = pcall(function() task.wait(0.01) error("после ожидания", 0) end) print(ok, v)', env, ctxT);
  await sleep(60);
  ok(out.join('|') === 'false после ожидания', 'wait внутри pcall', out.join('|'));
}

// @@E2E@@

(async () => {
  await timers();
  if (typeof e2e === 'function') await e2e();
  console.log(`\n${pass} ок, ${fail} ошибок`);
  process.exitCode = fail ? 1 : 0;
})();

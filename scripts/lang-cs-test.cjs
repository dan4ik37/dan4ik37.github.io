// Тесты C# для «Студии 3D» (js/engine/lang-cs.js): перевод C# → JavaScript и запуск в песочнице скриптов (runtime из
// js/engine/script.js) без браузера — как в scripts/engine-test.cjs. Проверяются вывод, ошибки с номером строки C#,
// события мира (Touched, Prompt, Tween, Heartbeat), классы как в Unity, корутины, async/await.
// Запуск из корня сайта: node scripts/lang-cs-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/script.js'), 'utf8'), { filename: 'script.js' });
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/lang-cs.js'), 'utf8'), { filename: 'lang-cs.js' });
delete globalThis.window;
const E = globalThis.D37E, L = E.langs.cs;
const LIB = '(' + L.worker.toString() + ')();';
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (process.env.CS_VERBOSE) console.log(cond ? 'ок  ' : 'НЕТ ', name); if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// переводчик отдельно (без мира)
const CC = vm.createContext({ console, setTimeout, clearTimeout });
vm.runInContext(LIB, CC);
const compile = code => CC.D37Lang.cs.compile(code);
// мир: песочница скриптов с деталями и игроком; d — сообщения хозяину (print, error, set, tween, player …)
const part = (id, name, extra = {}) => ({ id, cls: 'Part', parent: null, p: { name, pos: [0, 1, 0], size: [4, 1, 2], rot: [0, 0, 0], color: '#a3a2a5', mat: 'plastic', alpha: 0, collide: true, anchored: true, ...extra } });
function world(code, o = {}){
  const msgs = [];
  const ctx = vm.createContext({ postMessage: m => msgs.push(JSON.parse(JSON.stringify(m))), onmessage: null, setTimeout, clearTimeout, console });
  vm.runInContext('(' + E.scripts.runtime.toString() + ')()', ctx);
  const send = d => ctx.onmessage({ data: d });
  const objs = o.objs || [part('a', 'Деталь'), part('b', 'Пол', { pos: [0, 0, 0] }), { id: 'm', cls: 'Model', parent: null, p: { name: 'Дом' } }, { ...part('c', 'Окно'), parent: 'm' }];
  const scripts = (Array.isArray(code) ? code : [code]).map((c, i) => typeof c === 'string' ? { name: 'cs' + (i || ''), parent: o.parent === undefined ? 'a' : o.parent, lang: 'cs', code: c } : c);
  send({ t: 'init', players: o.players || [{ id: 'me', name: 'Тест', pos: [0, 0, 0] }], objs, scripts, libs: { cs: LIB } });
  return {
    msgs, send, ctx,
    prints: () => msgs.filter(m => m.t === 'print').map(m => m.text),
    errors: () => msgs.filter(m => m.t === 'error'),
    of: t => msgs.filter(m => m.t === t),
    tick(dt = 0.1, n = 1){ for (let i = 0; i < n; i++) send({ t: 'tick', dt }); },
    ev(ev, d = {}){ send({ t: 'ev', ev, player: 'me', ...d }); },
  };
}
async function out(title, code, want, o = {}){   // вывод Debug.Log / print
  const W = world(code, o);
  await sleep(o.wait || 1);
  if (o.ticks) { W.tick(o.dt || 0.1, o.ticks); await sleep(o.wait2 || 1); }
  const got = W.prints(), errs = W.errors().map(e => e.line + ': ' + e.msg);
  ok(!errs.length && JSON.stringify(got) === JSON.stringify(want), title, { got, errs });
  return W;
}
function cerr(title, code, line, re){   // ошибка перевода: строка и текст
  let e = null;
  try { compile(code); } catch (x) { e = x; }
  ok(e && e.cs && e.line === line && re.test(e.message), title, e ? { line: e.line, msg: e.message, cs: !!e.cs } : 'нет ошибки');
}
async function rerr(title, code, line, re, o = {}){   // ошибка во время игры: первая ошибка — на строке line
  const W = world(code, o);
  await sleep(o.wait || 5);
  if (o.act) { o.act(W); await sleep(o.wait2 || 5); }
  const er = W.errors();
  ok(er.length >= 1 && er[0].line === line && re.test(er[0].msg), title, er.map(e => e.line + ': ' + e.msg));
  return W;
}

async function main(){
  // ═══ Регистрация языка ═══
  ok(L && L.id === 'cs' && L.label === 'C# (как в Unity)' && L.short === 'C#' && L.icon === '♯' && L.kind === 'text', 'язык cs зарегистрирован');
  ok(typeof L.worker === 'function' && L.examples.length >= 8 && L.examples.length <= 10 && /Задача: $/.test(L.ai) && L.placeholder, 'примеры, задание для ИИ, подсказка');
  ok(E.langs.js && E.langs.js.label === 'JavaScript', 'JavaScript на месте');
  ok(typeof CC.D37Lang.cs.run === 'function' && typeof CC.D37Lang.cs.compile === 'function', 'D37Lang.cs в песочнице');

  // ═══ Числа и операторы ═══
  await out('int / int — целое деление', `int a = 7, b = 2;
Debug.Log(a / b);
Debug.Log(-7 / 2);
Debug.Log(7 % 3);
Debug.Log(-7 % 3);`, ['3', '-3', '1', '-1']);
  await out('float / double', `Debug.Log(7 / 2f);
Debug.Log(7 / 2.0);
Debug.Log(1f / 3f);
Debug.Log(1.0 / 3);
float f = 0.1f + 0.2f;
Debug.Log(f);`, ['3.5', '3.5', '0.3333333', '0.333333333333333', '0.3']);
  await out('приведения (int) к нулю, (char), (float)', `Debug.Log((int)3.9);
Debug.Log((int)-3.9f);
Debug.Log((float)7 / 2);
Debug.Log((int)'A');
Debug.Log((char)66);
double d = 2.7;
int i = (int)d;
Debug.Log(i);`, ['3', '-3', '3.5', '65', 'B', '2']);
  await out('суффиксы чисел: f d L m 0x 0b _', `Debug.Log(1.5f + 2d);
Debug.Log(10L * 3);
Debug.Log(0xFF);
Debug.Log(0b101);
Debug.Log(1_000_000);
Debug.Log(3m / 2);
Debug.Log(.5f + 1);`, ['3.5', '30', '255', '5', '1000000', '1.5', '1.5']);
  await out('составные присваивания', `int x = 10;
x += 5; x -= 3; x *= 2; x /= 5; x %= 3;
Debug.Log(x);
float y = 1;
y /= 4;
Debug.Log(y);
int z = 7;
z /= 2;
Debug.Log(z);
int w = 5;
w <<= 2; w |= 1; w ^= 3;
Debug.Log(w);`, ['1', '0.25', '3', '22']);
  await out('++ и -- (и в массиве)', `int i = 0;
i++;
++i;
int j = i++;
Debug.Log(i + " " + j);
int[] a = { 1, 2, 3 };
a[1]++;
a[2] += 10;
Debug.Log(string.Join(",", a));
int k = 5;
Debug.Log(k-- + " " + k + " " + --k);`, ['3 2', '1,3,13', '5 4 3']);
  await out('Mathf и Math', `Debug.Log(Mathf.Clamp(15, 0, 10));
Debug.Log(Mathf.Lerp(0, 10, 0.25f));
Debug.Log(Mathf.Abs(-3));
Debug.Log(Math.Max(2, 9));
Debug.Log(Mathf.Sqrt(16));
Debug.Log(Mathf.PingPong(3f, 2f));
Debug.Log(Mathf.Round(2.5f) + " " + Mathf.Round(3.5f) + " " + Math.Round(1.2345, 2));
Debug.Log(Mathf.FloorToInt(-1.5f));
Debug.Log(Mathf.Sign(0) + " " + Math.Sign(0));
Debug.Log(Mathf.PI.ToString("F4") + " " + (Mathf.Deg2Rad * 180).ToString("F4"));
Debug.Log(Mathf.Repeat(370, 360) + " " + Mathf.MoveTowards(0, 10, 3) + " " + Mathf.InverseLerp(10, 20, 15));`,
  ['10', '2.5', '3', '9', '4', '1', '2 4 1.23', '-2', '1 0', '3.1416 3.1416', '10 3 0.5']);
  await out('тип результата Mathf.Max(int, int) — int', `int a = Mathf.Max(3, 7);
float b = Mathf.Max(1.5f, 2);
Debug.Log(a / 2);
Debug.Log(b / 2);
Debug.Log(Mathf.Max(3, 4) / 2);
Debug.Log(Mathf.RoundToInt(7.6f) / 2);`, ['3', '1', '2', '4']);
  await out('Random.Range(int, int) и (float, float), System.Random', `int r = Random.Range(0, 3);
Debug.Log(r >= 0 && r < 3 && r == (int)r);
float f = Random.Range(0f, 1f);
Debug.Log(f >= 0 && f <= 1);
var rnd = new System.Random(42);
int a = rnd.Next(10);
var rnd2 = new System.Random(42);
Debug.Log(a == rnd2.Next(10));
int many = 0;
for (int i = 0; i < 200; i++) { int x = Random.Range(1, 4); if (x < 1 || x > 3) many++; }
Debug.Log(many);`, ['True', 'True', 'True', '0']);
  await out('числа в строке: форматы как в C#', `float t = 3.14159f;
Debug.Log($"{t:F2}|{t:0.0}|{42:D5}|{1234567.891:N2}|{0.256:P1}|{255:X2}|{7,3}|{7,-3}|");
Debug.Log(string.Format("{0} + {1} = {2}", 1, 2, 1 + 2));
Debug.Log(t.ToString("F1") + " " + 5.ToString() + " " + (2.5).ToString("0.00"));
Debug.Log($"{12.5:0}|{0.5:#.##}|{1234:#,##0}|{-3.14159:F3}");`, ['3.14|3.1|00042|1,234,567.89|25.6 %|FF|  7|7  |', '1 + 2 = 3', '3.1 5 2.50', '13|.5|1,234|-3.142']);
  await out('bool и null в строке', `bool b = true;
Debug.Log(b);
Debug.Log("v=" + false);
string s = null;
Debug.Log("[" + s + "]");
Debug.Log(b.ToString());
Debug.Log($"{s}|{b}");`, ['True', 'v=False', '[]', 'True', '|True']);
  await out('@"…", escape-последовательности, char', `Debug.Log(@"C:\\путь\\к ""файлу""");
Debug.Log("a\\tb\\\\n".Length);
char c = 'x';
Debug.Log(c);
Debug.Log('a' + 1);
Debug.Log((char)('a' + 1));
Debug.Log("abc"[1]);
Debug.Log('\\u0041');
Debug.Log("abc"[0] == 'a');`, ['C:\\путь\\к "файлу"', '5', 'x', '98', 'b', 'b', 'A', 'True']);
  await out('$"…" с выражениями и {{ }}', `int a = 3;
string n = "Аня";
Debug.Log($"{n} has {a * 2} {(a > 2 ? "много" : "мало")} {{скобки}}");
Debug.Log($@"путь\\{n}");`, ['Аня has 6 много {скобки}', 'путь\\Аня']);
  await out('методы строк', `string s = "  Hello, World  ";
Debug.Log(s.Trim());
Debug.Log(s.Trim().ToLower());
Debug.Log(s.Contains("World"));
Debug.Log(s.Trim().StartsWith("Hell"));
Debug.Log(s.Trim().Substring(7));
Debug.Log(s.Trim().Replace("l", "L"));
Debug.Log(s.Trim().IndexOf("o"));
var parts = "a,b,,c".Split(',');
Debug.Log(parts.Length + " " + string.Join("|", parts));
Debug.Log("a b  c".Split(' ', StringSplitOptions.RemoveEmptyEntries).Length);
Debug.Log(string.IsNullOrEmpty(""));
Debug.Log("ab".PadLeft(5, '*'));
Debug.Log("Привет".Length + " " + "abc".ToUpper()[1] + " " + "x-y".Split('-')[1]);
Debug.Log("ёлка".Substring(1, 2) + " " + "a".CompareTo("b") + " " + "abc".EndsWith("bc"));`,
  ['Hello, World', 'hello, world', 'True', 'True', 'World', 'HeLLo, WorLd', '4', '4 a|b||c', '3', 'True', '***ab', '6 B y', 'лк -1 True']);

  // ═══ Коллекции ═══
  await out('List<T>', `var xs = new List<int> { 5, 3, 8 };
xs.Add(1);
xs.Insert(0, 9);
xs.Remove(3);
xs.Sort();
Debug.Log(string.Join(",", xs));
Debug.Log(xs.Count + " " + xs.Contains(8) + " " + xs.IndexOf(8) + " " + xs[0]);
xs.RemoveAt(0);
xs.Reverse();
Debug.Log(string.Join(",", xs));
Debug.Log(xs.Find(x => x > 5));
Debug.Log(xs.Exists(x => x == 5));
var arr = xs.ToArray();
Debug.Log(arr.Length);
xs.Clear();
Debug.Log(xs.Count);
List<string> names = new List<string>();
names.Add("Б"); names.Add("А");
names.Sort();
foreach (string nm in names) Debug.Log(nm);`, ['1,5,8,9', '4 True 2 1', '9,8,5', '9', 'True', '3', '0', 'А', 'Б']);
  await out('Dictionary<K,V>', `var d = new Dictionary<string, int> { { "яблоко", 3 }, { "груша", 5 } };
d["слива"] = 1;
d["яблоко"] += 10;
Debug.Log(d.Count + " " + d["яблоко"]);
Debug.Log(d.ContainsKey("груша") + " " + d.ContainsKey("киви"));
foreach (var kv in d) Debug.Log(kv.Key + ":" + kv.Value);
if (!d.TryGetValue("киви", out int k)) Debug.Log("нет киви " + k);
d.Remove("груша");
Debug.Log(string.Join(",", d.Keys));
int sum = 0;
foreach (var v in d.Values) sum += v;
Debug.Log(sum);
var e = new Dictionary<int, string> { [1] = "один", [2] = "два" };
Debug.Log(e[2] + e.Count);
foreach (KeyValuePair<int, string> p in e) Debug.Log(p.Key * 10);`,
  ['3 13', 'True False', 'яблоко:13', 'груша:5', 'слива:1', 'нет киви 0', 'яблоко,слива', '14', 'два2', '10', '20']);
  await out('foreach (var (k, v) in словарь)', `var d = new Dictionary<string, int> { ["a"] = 1, ["b"] = 2 };
foreach (var (key, val) in d) Debug.Log(key + val * 10);`, ['a10', 'b20']);
  await out('LINQ', `var xs = new List<int> { 4, 1, 3, 2, 5 };
Debug.Log(string.Join(",", xs.Where(x => x % 2 == 1).Select(x => x * 10)));
Debug.Log(xs.Sum() + " " + xs.Max() + " " + xs.Min() + " " + xs.Average());
Debug.Log(xs.Count(x => x > 2));
Debug.Log(string.Join(",", xs.OrderByDescending(x => x).Take(2)));
Debug.Log(xs.Any(x => x > 4) + " " + xs.All(x => x > 0));
Debug.Log(xs.First() + " " + xs.Last(x => x < 3) + " " + xs.FirstOrDefault(x => x > 10));
var words = new List<string> { "кот", "собака", "ёж" };
Debug.Log(string.Join(",", words.OrderBy(w => w.Length).Select(w => w.ToUpper())));
Debug.Log(words.Select(w => w.Length).Sum() / 2);
Debug.Log(string.Join(",", xs.Distinct().Skip(3)));`, ['10,30,50', '15 5 1 3', '3', '5,4', 'True True', '4 2 0', 'ЁЖ,КОТ,СОБАКА', '5', '2,5']);
  await out('массивы: new int[n], { }, new[] { }, [,], [][]', `int[] a = new int[3];
a[0] = 5;
int[] b = { 1, 2, 3 };
var c = new[] { 1.5f, 2f };
string[] s = new string[2];
Debug.Log(a[0] + a[1] + b.Length + c[0]);
Debug.Log(s[0] == null);
int[,] g = new int[2, 3];
g[1, 2] = 7;
Debug.Log(g[1, 2] + " " + g.GetLength(0) + " " + g.GetLength(1) + " " + g.Length);
var jag = new int[2][];
jag[0] = new int[] { 1, 2 };
Debug.Log(jag[0][1]);
int[,] m = { { 1, 2 }, { 3, 4 } };
Debug.Log(m[1, 0]);
Vector3[] pts = new Vector3[2];
Debug.Log(pts[1]);`, ['9.5', 'True', '7 2 3 6', '2', '3', '(0.00, 0.00, 0.00)']);
  await out('Queue, Stack, HashSet, StringBuilder', `var q = new Queue<int>();
q.Enqueue(1); q.Enqueue(2);
Debug.Log(q.Dequeue() + " " + q.Count);
var st = new Stack<string>();
st.Push("a"); st.Push("b");
Debug.Log(st.Peek() + st.Pop() + st.Count);
var hs = new HashSet<int> { 1, 2 };
Debug.Log(hs.Add(2) + " " + hs.Add(3) + " " + hs.Count + " " + hs.Contains(3));
var sb = new System.Text.StringBuilder();
sb.Append("a").Append(1).AppendLine();
sb.Append($"{2:F1}");
Debug.Log(sb.ToString().Replace("\\n", "|"));
Debug.Log(char.IsDigit('5') + " " + char.IsLetter('я') + " " + char.ToUpper('б'));`, ['1 1', 'bb1', 'False True 3 True', 'a1|2.0', 'True True Б']);
  await out('индекс с конца ^1 и диапазоны a..b', `int[] a = { 1, 2, 3, 4 };
Debug.Log(a[^1]);
Debug.Log(string.Join(",", a[1..3]));
Debug.Log("Привет"[..3]);
var l = new List<int> { 7, 8, 9 };
Debug.Log(l[^2]);`, ['4', '2,3', 'При', '8']);
  await out('коллекции C# 12: [1, 2, 3]', `int[] a = [1, 2, 3];
List<string> b = ["x", "y"];
Debug.Log(a.Length + b.Count);`, ['5']);
  await out('целое деление у Count / Length / элементов', `List<int> xs = new() { 1, 2, 3 };
Debug.Log(xs.Count / 2);
Debug.Log(xs[2] / 2);
Debug.Log("abcd".Length / 3);
int[] arr = { 9 };
Debug.Log(arr[0] / 2);
Debug.Log(arr.Length / 2f);
var d = new Dictionary<string, int> { ["k"] = 5 };
Debug.Log(d["k"] / 2);`, ['1', '1', '1', '4', '0.5', '2']);

  // ═══ Управление ходом программы ═══
  await out('for / while / do / break / continue / switch', `int total = 0;
for (int i = 0; i < 10; i++) { if (i == 3) continue; if (i == 7) break; total += i; }
Debug.Log(total);
int n = 0;
while (n < 5) n += 2;
Debug.Log(n);
do { n--; } while (n > 3);
Debug.Log(n);
string Name(int d)
{
    switch (d)
    {
        case 0: return "ноль";
        case 1:
        case 2: return "мало";
        default: return "много";
    }
}
Debug.Log(Name(0) + Name(2) + Name(9));
for (int i = 0, j = 10; i < j; i += 3, j -= 3) Debug.Log(i + ":" + j);
string word = "b";
switch (word) { case "a": Debug.Log("A"); break; case "b": Debug.Log("B"); break; }`, ['18', '6', '3', 'нольмаломного', '0:10', '3:7', 'B']);
  await out('switch с шаблонами и switch-выражение', `object o = 5;
switch (o)
{
    case string s: Debug.Log("str " + s); break;
    case int i when i > 3: Debug.Log("big " + i); break;
    default: Debug.Log("other"); break;
}
int score = 75;
string grade = score switch { >= 90 => "A", >= 70 and < 90 => "B", _ => "C" };
Debug.Log(grade);
var day = 6;
Debug.Log(day switch { 6 or 7 => "выходной", _ => "будни" });
for (int k = 0; k < 3; k++)
{
    switch (k) { case 1: continue; }
    Debug.Log("k" + k);
}`, ['big 5', 'B', 'выходной', 'k0', 'k2']);
  await out('is / as / шаблоны', `object x = "hi";
if (x is string s && s.Length == 2) Debug.Log("строка " + s);
object y = null;
Debug.Log(y is null);
Debug.Log(x is not null);
int v = 7;
Debug.Log(v is > 5 and < 10);
var str = x as string;
Debug.Log(str.ToUpper());
object num = 2.5f;
Debug.Log(num is int);
Debug.Log(num is float f2 ? f2 * 2 : 0);`, ['строка hi', 'True', 'True', 'True', 'HI', 'False', '5']);
  await out('?: ?? ??= ?.', `string a = null;
Debug.Log(a ?? "пусто");
Debug.Log(a?.Length ?? -1);
a ??= "задано";
Debug.Log(a + " " + a?.Length);
int? n = null;
Debug.Log((n ?? 3) * 2);
var list = new List<string>();
Debug.Log(list?.Count);
string t = list.Count > 0 ? "есть" : "пусто";
Debug.Log(t);`, ['пусто', '-1', 'задано 6', '6', '0', 'пусто']);
  await out('локальные функции, рекурсия, params, значения по умолчанию', `int Fact(int n) => n <= 1 ? 1 : n * Fact(n - 1);
Debug.Log(Fact(5));
void Greet(string who = "мир") { Debug.Log("Привет, " + who); }
Greet();
Greet("Аня");
Greet(who: "Боря");
int Sum(params int[] xs) { int s = 0; foreach (var x in xs) s += x; return s; }
Debug.Log(Sum(1, 2, 3) + " " + Sum());
int[] nums = { 4, 5 };
Debug.Log(Sum(nums));
Debug.Log(Later(2));
int Later(int k) => k * 100;`, ['120', 'Привет, мир', 'Привет, Аня', 'Привет, Боря', '6 0', '9', '200']);
  await out('ref, out, TryParse, обмен (a, b) = (b, a)', `void Swap(ref int a, ref int b) { int t = a; a = b; b = t; }
int x = 1, y = 2;
Swap(ref x, ref y);
Debug.Log(x + "," + y);
bool TryHalf(int v, out int h) { h = v / 2; return v % 2 == 0; }
if (TryHalf(10, out var h1)) Debug.Log("half " + h1);
Debug.Log(int.TryParse("42", out int p) ? p + 1 : -1);
Debug.Log(int.TryParse("x", out int q) + " " + q);
Debug.Log(float.TryParse("2.5", out float fl) + " " + fl);
(x, y) = (y, x);
Debug.Log(x + "," + y);
Debug.Log(int.Parse("7") * 2 + float.Parse("0.5"));`, ['2,1', 'half 5', '43', 'False 0', 'True 2.5', '1,2', '14.5']);
  await out('лямбды и замыкания, Func/Action', `var fs = new List<Func<int>>();
for (int i = 0; i < 3; i++) { int j = i; fs.Add(() => j * 10); }
Debug.Log(string.Join(",", fs.Select(f => f())));
Func<int, int, int> add = (a, b) => a + b;
Action<string> say = s => Debug.Log("» " + s);
say(add(2, 3).ToString());
Func<float, float> half = delegate (float v) { return v / 2; };
Debug.Log(half(5));
Action twice = null;
twice += () => Debug.Log("раз");
twice += () => Debug.Log("два");
twice();
Predicate<int> even = n => n % 2 == 0;
Debug.Log(even(4) + " " + even.Invoke(3));`, ['0,10,20', '» 5', '2.5', 'раз', 'два', 'True False']);

  // ═══ Классы ═══
  await out('классы: свойства, конструкторы, наследование, override, интерфейсы, static', `var zoo = new List<Animal> { new Cat("Мурка"), new Bird("Кеша") };
foreach (var a in zoo) Debug.Log(a.Hi());
Debug.Log(Animal.Count + " " + zoo[1] + " " + (zoo[1] is Bird b && b.CanFly) + " " + (zoo[0] is IHello));

interface IHello { string Hi(); }
abstract class Animal : IHello
{
    public string Name { get; set; }
    protected int legs;
    public static int Count;
    public Animal(string name, int legs) { Name = name; this.legs = legs; Count++; }
    public abstract string Sound();
    public virtual string Hi() => $"{Name} говорит {Sound()}";
    public override string ToString() => Name + "(" + legs + ")";
}
class Cat : Animal
{
    public Cat(string n) : base(n, 4) { }
    public override string Sound() => "мяу";
}
class Bird : Animal
{
    public bool CanFly { get; } = true;
    public Bird(string n) : base(n, 2) { }
    public override string Sound() => "чирик";
    public override string Hi() => base.Hi() + "!";
}`, ['Мурка говорит мяу', 'Кеша говорит чирик!', '2 Кеша(2) True True']);
  await out('struct, перегрузка операторов, свойства с логикой', `var a = new Money(5);
var b = new Money(7);
var c = a + b;
Debug.Log(c.Value + " " + (c > a) + " " + (a == new Money(5)) + " " + (a != b));
var w = new Wallet();
w.Coins = 150;
Debug.Log(w.Coins);
w.Coins = -5;
Debug.Log(w.Coins + " " + w.Rich);
var m1 = new Money(1);
var m2 = m1;
m2.Value = 9;
Debug.Log(m1.Value + " " + m2.Value);

struct Money
{
    public int Value;
    public Money(int v) { Value = v; }
    public static Money operator +(Money x, Money y) => new Money(x.Value + y.Value);
    public static bool operator >(Money x, Money y) => x.Value > y.Value;
    public static bool operator <(Money x, Money y) => x.Value < y.Value;
    public static bool operator ==(Money x, Money y) => x.Value == y.Value;
    public static bool operator !=(Money x, Money y) => x.Value != y.Value;
}
class Wallet
{
    private int coins;
    public int Coins { get { return coins; } set { coins = Math.Max(0, value); } }
    public bool Rich => coins > 100;
}`, ['12 True True True', '150', '0 False', '1 9']);
  await out('enum: имя в строке, (int), switch', `State s = State.Run;
Debug.Log(s);
Debug.Log((int)State.Jump);
Debug.Log(s == State.Run ? "бег" : "нет");
s = State.Idle;
switch (s) { case State.Idle: Debug.Log("стоит"); break; case State.Run: Debug.Log("бежит"); break; }
Debug.Log($"{State.Jump}|{s.ToString()}");
State t = (State)5;
Debug.Log(t);
enum State { Idle, Run = 5, Jump }`, ['Run', '6', 'бег', 'стоит', 'Jump|Idle', 'Run']);
  await out('static class, const, readonly, перегрузки методов', `Debug.Log(Utils.Square(4) + " " + Utils.Max + " " + Utils.Greeting);
Debug.Log(P.Show(5));
Debug.Log(P.Show(2.5f));
Debug.Log(P.Show("x"));
Debug.Log(P.Show(1, 2));
var pp = new P(3);
var pq = new P("x", 2);
Debug.Log(pp.v + " " + pq.v);

static class Utils
{
    public const int Max = 10;
    public static readonly string Greeting = "Привет";
    public static int Square(int x) => x * x;
}
class P
{
    public int v;
    public P(int a) { v = a; }
    public P(string s, int a) : this(a * 10) { v += 1; }
    public static string Show(int x) => "int " + x;
    public static string Show(float x) => "float " + x;
    public static string Show(string s) => "str " + s;
    public static string Show(int a, int b) => "two " + (a + b);
}`, ['16 10 Привет', 'int 5', 'float 2.5', 'str x', 'two 3', '3 21']);
  await out('события и делегаты в своих классах', `var b = new Bell();
int hits = 0;
Action<string> h = msg => { hits++; Debug.Log("слышу " + msg); };
b.Rung += h;
b.Rung += msg => Debug.Log("и я " + msg);
b.Ring("дзынь");
b.Rung -= h;
b.Ring("бом");
Debug.Log(hits);
Func<int, int> twice = x => x * 2;
Debug.Log(twice(21));

class Bell
{
    public event Action<string> Rung;
    public void Ring(string s) { Rung?.Invoke(s); }
}`, ['слышу дзынь', 'и я дзынь', 'и я бом', '1', '42']);
  await out('generic-классы и методы, object initializer, ToString', `var box = new Box<int>(5);
Debug.Log(box.Get() + 1);
T First<T>(List<T> xs) => xs[0];
Debug.Log(First(new List<string> { "x", "y" }));
var pt = new Pt { X = 3, Y = 4 };
Debug.Log(pt.Len + " " + pt);

class Box<T>
{
    T v;
    public Box(T v) { this.v = v; }
    public T Get() => v;
}
class Pt
{
    public int X { get; set; }
    public int Y { get; set; }
    public double Len => Math.Sqrt(X * X + Y * Y);
    public override string ToString() => $"({X}; {Y})";
}`, ['6', 'x', '5 (3; 4)']);
  await out('индексатор и вложенный класс', `var g = new Grid();
g[1] = "x";
Debug.Log(g[1] + g[0] + Grid.Cell.Size);
class Grid
{
    string[] cells = { "a", "b", "c" };
    public string this[int i] { get => cells[i]; set => cells[i] = value; }
    public class Cell { public const int Size = 2; }
}`, ['xa2']);
  await out('исключения: try/catch/finally, throw;, when, свои', `try { throw new InvalidOperationException("плохо"); }
catch (InvalidOperationException e) { Debug.Log("поймал " + e.Message); }
finally { Debug.Log("finally"); }
try { int[] a = new int[1]; a[5] = 1; } catch (IndexOutOfRangeException) { Debug.Log("индекс"); }
try { string s = null; Debug.Log(s.Length); } catch (NullReferenceException) { Debug.Log("null"); }
try { throw new MyErr("свой", 7); } catch (MyErr e) when (e.Code == 7) { Debug.Log(e.Message + e.Code); }
try { try { throw new Exception("внутри"); } catch (Exception e) { Debug.Log("1 " + e.Message); throw; } }
catch (Exception e) { Debug.Log("2 " + e.Message); }
int Div(int a, int b) { try { return a / b; } catch (DivideByZeroException) { return -1; } }
Debug.Log(Div(1, 0));
try { var d = new Dictionary<string, int>(); Debug.Log(d["нет"]); } catch (KeyNotFoundException e) { Debug.Log("ключ: " + (e.Message.Length > 0)); }
try { int.Parse("abc"); } catch (FormatException) { Debug.Log("формат"); } catch (Exception) { Debug.Log("другое"); }
class MyErr : Exception
{
    public int Code;
    public MyErr(string m, int c) : base(m) { Code = c; }
}`, ['поймал плохо', 'finally', 'индекс', 'null', 'свой7', '1 внутри', '2 внутри', '-1', 'ключ: True', 'формат']);

  // ═══ Vector3, цвет, кортежи ═══
  await out('Vector3: + - * / == и методы Unity', `var a = new Vector3(1, 2, 3);
var b = Vector3.one * 2;
Debug.Log(a + b);
Debug.Log(a - b);
Debug.Log(-a);
Debug.Log(a * 2);
Debug.Log(2 * a);
Debug.Log(a / 2);
Debug.Log(Vector3.Distance(Vector3.zero, new Vector3(3, 4, 0)));
Debug.Log(Vector3.up + Vector3.forward == new Vector3(0, 1, 1));
var c = a;
c.y = 10;
Debug.Log(a.y + " " + c.y);
Debug.Log(new Vector3(3, 0, 4).magnitude + " " + new Vector3(0, 0, 5).normalized);
Debug.Log(Vector3.Lerp(Vector3.zero, new Vector3(10, 0, 0), 0.5f).x);
Vector3 p = Vector3.zero;
p += Vector3.right * 3;
p.z += 1;
Debug.Log(p);
Debug.Log(Vector3.Dot(Vector3.right, Vector3.up) + " " + Vector3.Cross(Vector3.right, Vector3.up));
var v = new Vector3(0, 3, 4);
v.Normalize();
Debug.Log(v.y.ToString("F1") + " " + v.X.ToString("F1"));
Vector3 q = new Vector3(1, 1, 1);
q.Set(5, 6, 7);
Debug.Log(q + " " + q.ToString("F0"));`,
  ['(3.00, 4.00, 5.00)', '(-1.00, 0.00, 1.00)', '(-1.00, -2.00, -3.00)', '(2.00, 4.00, 6.00)', '(2.00, 4.00, 6.00)', '(0.50, 1.00, 1.50)', '5', 'True', '2 10',
   '5 (0.00, 0.00, 1.00)', '5', '(3.00, 0.00, 1.00)', '0 (0.00, 0.00, 1.00)', '0.6 0.0', '(5.00, 6.00, 7.00) (5, 6, 7)']);
  await out('Color: Color.red, new Color, Lerp, Color3', `Color c = Color.red;
Debug.Log(c);
Debug.Log(new Color(0, 1, 0));
Debug.Log(Color.Lerp(Color.black, Color.white, 0.5f));
Debug.Log(Color3.fromRGB(0, 0, 255));
Debug.Log(new Color32(255, 128, 0, 255));`, ['#ff0000', '#00ff00', '#808080', '#0000ff', '#ff8000']);
  await out('кортежи', `(int, string) t = (1, "a");
Debug.Log(t.Item1 + t.Item2);
var (n, s) = (2, "b");
Debug.Log(n + s);
(int min, int max) MinMax(int[] a) => (a.Min(), a.Max());
var r = MinMax(new[] { 3, 1, 4 });
Debug.Log(r.min + ".." + r.max);
var named = (x: 5, y: 6);
Debug.Log(named.x * named.y);`, ['1a', '2b', '1..4', '30']);
  await out('using / namespace (блок и файловый) / Program.Main', `using System;
using System.Collections.Generic;
using UnityEngine;
namespace My.Game
{
    class Program { static void Main(string[] args) { Console.WriteLine("main"); Console.WriteLine("{0}-{1}", 1, 2); } }
}`, ['main', '1-2']);
  await out('namespace;, print, default, nameof', `namespace Demo;
int x = default;
string s = default;
float f = default(float);
Debug.Log(x + " " + (s == null) + " " + nameof(x) + " " + f);
print(1.5f, true, "т");`, ['0 True x 0', '1.5 True т']);

  // ═══ Ошибки перевода: строка C# и понятный текст ═══
  cerr('нет «;» — ошибка на своей строке', 'int a = 5\nDebug.Log(a);', 1, /Ожидалось «;»/);
  cerr('неизвестное имя', 'int a = 1;\nDebug.Log(b);', 2, /Имя «b» не найдено/);
  cerr('неизвестный тип', 'int x = 1;\nVecter3 v = Vector3.zero;', 2, /Тип «Vecter3» не найден/);
  cerr('goto и метки', 'int i = 0;\nstart:\ni++;', 2, /Метки и goto/);
  cerr('LINQ-запрос from … select', 'var xs = new List<int>();\nvar q = from x in xs select x;', 2, /LINQ/);
  cerr('Rigidbody — подсказка', 'public class A : Script\n{\n    Rigidbody rb;\n}', 3, /Rigidbody.*Anchored/);
  cerr('Input — подсказка', 'int k = 1;\nif (Input.GetKey("a")) { }', 2, /клавиатура/);
  cerr('незакрытая строка', 'int a = 1;\nDebug.Log("abc);', 2, /Незакрытая строка/);
  cerr('число аргументов своего метода', 'void F(int a) { }\nF(1, 2);', 2, /ждёт 1/);
  cerr('await без async', 'public class A : Script\n{\n    void Start()\n    {\n        await Task.Delay(1);\n    }\n}', 5, /async/);
  cerr('x == 5; — не инструкция', 'int x = 5;\nx == 5;', 2, /ничего не делает/);
  cerr('yield в void-методе', 'int a = 0;\nvoid F() { yield return null; }', 2, /IEnumerator/);
  cerr('break вне цикла', 'int a = 0;\nbreak;', 2, /break/);
  cerr('не хватает «}»', 'void F() {\n    Debug.Log(1);\n', 3, /Не хватает «}»/);
  cerr('переменная объявлена дважды', 'int a = 1;\nint a = 2;', 2, /уже объявлена/);
  cerr('нет такого метода у Mathf', 'float x = 1;\nDebug.Log(Mathf.Sinn(x));', 2, /Mathf\.Sinn/);
  cerr('подсказка регистра: Mathf.sin', 'Debug.Log(Mathf.sin(1));', 1, /может, Mathf\.Sin/);
  cerr('if (x = 2) — нужен bool', 'int x = 1;\nif (x = 2) { }', 2, /bool.*==/);
  cerr('var без значения', 'var x;', 1, /var/);
  cerr('класс объявлен дважды', 'class A { }\nclass A { }', 2, /объявлен дважды/);
  cerr("строка в одинарных кавычках", "int a = 1;\nstring s = 'abc';", 2, /ровно один символ/);
  cerr('Vector2 — подсказка', 'Vector2 v;', 1, /Vector2.*Vector3/);
  cerr('return значения из void', 'void F()\n{\n    return 5;\n}', 3, /void/);
  cerr('throw; вне catch', 'int a = 1;\nthrow;', 2, /throw;/);
  cerr('незакрытый комментарий', 'int a = 1;\n/* комментарий', 2, /комментарий/);
  cerr('неизвестный базовый класс', 'class B : Foo { }', 1, /Базовый тип «Foo»/);
  cerr('new Part() — подсказка', 'var p = new Part();', 1, /Instance\.new/);
  cerr('static-метод не видит поле', 'class A\n{\n    int hp = 5;\n    static void F() { hp = 1; }\n}', 4, /static/);
  { let e = null; try { compile('public class S : MonoBehaviour { void Start() { Destroy(gameObject, 2f); transform.position += Vector3.up; } }'); } catch (x) { e = x; } ok(!e, 'Unity-класс переводится без ошибок', e && e.message); }
  // строки JS совпадают со строками C# (простые инструкции — на своих строках)
  {
    const r = compile('int a = 1;\nint b = 2;\n\nDebug.Log(a + b);\nfloat c = a / 2f;');
    const js = r.js.split('\n');
    ok(/let a = 1/.test(js[0]) && /let b = 2/.test(js[1]) && /Debug\.Log/.test(js[3]) && /let c =/.test(js[4]), 'строки JS = строки C#', js.slice(0, 5));
  }

  // ═══ Ошибки во время игры: строка C# ═══
  await rerr('null в обработчике Touched — строка внутри лямбды', `var p = script.Parent;
p.Touched += (hit, player) =>
{
    Debug.Log("касание");
    var x = workspace.FindFirstChild("Нет");
    Debug.Log(x.Name);
};`, 6, /NullReferenceException.*Name/, { act: W => W.ev('touched', { id: 'a' }) });
  await rerr('деление на ноль в Update класса', `public class S : Script
{
    int zero = 0;
    void Update(float dt)
    {
        int k = 10 / zero;
    }
}`, 6, /DivideByZeroException/, { act: W => W.tick(0.1, 2) });
  await rerr('нет ключа в словаре', `var d = new Dictionary<string, int>();
d["a"] = 1;
Debug.Log(d["b"]);`, 3, /KeyNotFoundException.*«b»/);
  await rerr('индекс списка вне границ', `var xs = new List<int> { 1, 2 };
int i = 5;
Debug.Log(xs[i]);`, 3, /IndexOutOfRangeException/);
  await rerr('ошибка в корутине после WaitForSeconds', `public class S : Script
{
    void Start() { StartCoroutine(Go()); }
    IEnumerator Go()
    {
        yield return new WaitForSeconds(0.02f);
        string s = null;
        Debug.Log(s.Length);
    }
}`, 8, /NullReferenceException/, { wait: 60 });
  await rerr('ошибка после await', `async void Later()
{
    await Task.Delay(10);
    int[] a = new int[1];
    a[3] = 1;
}
Later();`, 5, /IndexOutOfRangeException/, { wait: 50 });
  await rerr('throw во вложенном методе — строка throw', `void Inner()
{
    throw new Exception("бум");
}
void Outer() { Inner(); }
Outer();`, 3, /^Exception: бум$/);
  await rerr('неверный цвет — ошибка мира со строкой C#', `var p = script.Parent;
p.Color = "red";`, 2, /Цвет/);
  await rerr('ошибка в инициализаторе поля класса', `public class S : Script
{
    static string s;
    int n = s.Length;
}`, 4, /NullReferenceException/);
  await rerr('бесконечная рекурсия', `int F(int n) => F(n + 1) + 1;
Debug.Log(F(0));`, 1, /StackOverflowException|рекурсия/);
  await rerr('ошибка в лямбде LINQ', `var xs = new List<int> { 1, 0, 2 };
var ys = xs.Select(x =>
    10 / x).ToList();`, 3, /DivideByZeroException/);
  await rerr('ошибка в локальной функции — её строка', `int Div(int a, int b)
{
    return a / b;
}
Debug.Log(Div(4, 2));
Debug.Log(Div(1, 0));`, 3, /DivideByZeroException/);
  {
    const W = world(`public class S : Script
{
    void Update(float dt)
    {
        object o = null;
        Debug.Log(o.ToString());
    }
}`);
    W.tick(0.1, 10); await sleep(5);
    const er = W.errors();
    ok(er.length === 1 && er[0].line === 6, 'ошибка в Update — одна, а не каждый кадр', er.map(e => e.line + ': ' + e.msg));
  }
  {   // ошибка перевода приходит в «Вывод» со строкой
    const W = world('int a = 1;\nDebug.Log(a)\nDebug.Log(2);');
    const er = W.errors();
    ok(er.length === 1 && er[0].line === 2 && er[0].script === 'cs' && /;/.test(er[0].msg) && W.of('ready').length === 1, 'ошибка перевода — в «Вывод», мир живёт', er);
  }

  // ═══ Мир: события, Tween, Heartbeat, Update, корутины, async ═══
  {   // монетка (верхний уровень): касание → очко и исчезла; второй раз — ничего
    const W = world(`var coin = script.Parent;
coin.Touched += (hit, player) =>
{
    if (player == null) return;
    player.AddStat("Монеты", 1);
    coin.Destroy();
};`);
    ok(W.of('want').some(m => m.ev === 'touched' && m.id === 'a' && m.on), 'Touched += — подписка уходит хозяину');
    W.ev('touched', { id: 'a' });
    ok(W.of('player').some(m => m.cmd === 'stat' && m.v.k === 'Монеты' && m.v.v === 1) && W.of('destroy').some(m => m.id === 'a'), 'монетка: очко и исчезла');
    const n = W.msgs.length;
    W.ev('touched', { id: 'a' });
    ok(W.msgs.length === n && !W.errors().length, 'удалённая монетка больше не срабатывает');
  }
  {   // дверь: Prompt + TweenService
    const W = world(`var door = script.Parent;
Vector3 closed = door.Position;
bool open = false;
door.Prompt("Открыть").Triggered += player =>
{
    open = !open;
    var to = open ? closed + Vector3.up * 3 : closed;
    TweenService.Create(door, new TweenInfo(0.5f), new { Position = to }).Play();
};`);
    ok(W.of('prompt').some(m => m.id === 'a' && m.text === 'Открыть'), 'Prompt("Открыть") — подсказка у детали');
    W.ev('prompt', { id: 'a' });
    const tw = W.of('tween')[0];
    ok(tw && tw.id === 'a' && tw.goals.pos.join() === '0,4,0' && tw.time === 0.5, 'Triggered → Tween вверх на 3', tw);
    W.ev('prompt', { id: 'a' });
    const tw2 = W.of('tween')[1];
    ok(tw2 && tw2.goals.pos.join() === '0,1,0', 'второй раз — назад', tw2);
  }
  {   // Tween с повтором, Completed
    const W = world(`var p = script.Parent;
var info = new TweenInfo(3f, Enum.EasingStyle.Sine, null, -1, true);
var t = TweenService.Create(p, info, new { Position = p.Position + new Vector3(0, 0, 12), Transparency = 0.5f });
t.Completed += s => Debug.Log("готово");
t.Play();`);
    const tw = W.of('tween')[0];
    ok(tw && tw.goals.pos.join() === '0,1,12' && tw.goals.alpha === 0.5 && tw.ease === 'sine' && tw.repeat === -1 && tw.reverses === true && tw.time === 3, 'TweenInfo(время, Sine, –, -1, true)', tw);
    W.ev('tweenDone', { tid: tw.tid });
    ok(W.prints().includes('готово'), 'Tween.Completed');
  }
  {   // RunService.Heartbeat += / -=
    const W = world(`float total = 0;
Action<float> beat = null;
beat = dt =>
{
    total += dt;
    if (total >= 0.3f) { Debug.Log("стоп " + total.ToString("F1")); RunService.Heartbeat -= beat; }
};
RunService.Heartbeat += beat;`);
    ok(W.of('want').some(m => m.ev === 'heartbeat' && m.on), 'Heartbeat += — кадры нужны');
    W.tick(0.1, 6);
    ok(JSON.stringify(W.prints()) === '["стоп 0.3"]' && W.of('want').some(m => m.ev === 'heartbeat' && !m.on), 'Heartbeat -= — отписка, кадры не нужны', W.prints());
  }
  {   // класс: Update(dt), Update() + Time.deltaTime, поля, static
    const W = world(`public class Spinner : Script
{
    public float speed = 90f;
    void Update(float dt)
    {
        Vector3 r = Parent.Orientation;
        Parent.Orientation = new Vector3(r.x, (r.y + speed * dt) % 360f, r.z);
    }
}
public class Counter : MonoBehaviour
{
    int frames;
    float sum;
    void Update() { frames++; sum += Time.deltaTime; if (frames == 3) Debug.Log(frames + " " + sum.ToString("F2") + " " + (Time.frameCount > 0)); }
}`);
    W.tick(0.1, 3);
    const rots = W.of('set').filter(m => m.id === 'a' && m.k === 'rot').map(m => m.v[1]);
    ok(rots.length === 3 && Math.abs(rots[2] - 27) < 1e-9, 'Update(float dt): крутится 90°/с', rots);
    ok(JSON.stringify(W.prints()) === '["3 0.30 True"]', 'Update() + Time.deltaTime', W.prints());
  }
  {   // корутины: WaitForSeconds, null, WaitUntil, вложенная, StopCoroutine
    const W = world(`public class Co : Script
{
    bool go;
    Coroutine loop;
    void Start()
    {
        StartCoroutine(Steps());
        loop = StartCoroutine(Loop());
    }
    IEnumerator Steps()
    {
        Debug.Log("a");
        yield return new WaitForSeconds(0.03f);
        Debug.Log("b");
        yield return null;
        Debug.Log("c");
        go = true;
        yield return StartCoroutine(Inner());
        Debug.Log("e");
        StopCoroutine(loop);
    }
    IEnumerator Inner()
    {
        yield return new WaitUntil(() => go);
        Debug.Log("d");
    }
    IEnumerator Loop()
    {
        while (true) { yield return null; }
    }
}`);
    ok(JSON.stringify(W.prints()) === '["a"]', 'корутина идёт сразу до первого yield', W.prints());
    await sleep(45);
    ok(JSON.stringify(W.prints()) === '["a","b"]', 'WaitForSeconds(0.03)', W.prints());
    W.tick(0.016, 1);
    ok(JSON.stringify(W.prints()) === '["a","b","c"]', 'yield return null — следующий кадр', W.prints());
    W.tick(0.016, 3);
    ok(JSON.stringify(W.prints()) === '["a","b","c","d","e"]' && !W.errors().length, 'WaitUntil, вложенная корутина, StopCoroutine', [W.prints(), W.errors()]);
  }
  {   // корутина сверху (без класса) и yield break
    const W = world(`IEnumerator Count(int n)
{
    for (int i = 1; i <= n; i++)
    {
        if (i == 3) yield break;
        Debug.Log("i" + i);
        yield return new WaitForSeconds(0.01f);
    }
}
StartCoroutine(Count(5));`);
    await sleep(60);
    ok(JSON.stringify(W.prints()) === '["i1","i2"]' && !W.errors().length, 'StartCoroutine сверху и yield break', [W.prints(), W.errors()]);
  }
  {   // async / await: Task.Delay, task.wait, async Task<int>, await в обработчике
    const W = world(`async Task<int> Twice(int x) { await Task.Delay(5); return x * 2; }
Debug.Log("start");
await Task.Delay(10);
Debug.Log("10 мс");
float waited = await task.wait(0.01f);
Debug.Log("wait " + (waited > 0));
int r = await Twice(21);
Debug.Log("twice " + r);
script.Parent.Clicked += async player =>
{
    await Task.Delay(5);
    Debug.Log("клик " + player.Name);
};`);
    ok(JSON.stringify(W.prints()) === '["start"]', 'код сверху идёт до первого await');
    await sleep(60);
    ok(JSON.stringify(W.prints()) === '["start","10 мс","wait True","twice 42"]', 'await Task.Delay / task.wait / async Task<int>', W.prints());
    ok(W.of('want').some(m => m.ev === 'clicked' && m.id === 'a' && m.on), 'Clicked += — деталь кликабельна');
    W.ev('clicked', { id: 'a' });
    await sleep(20);
    ok(W.prints().includes('клик Тест') && !W.errors().length, 'async-лямбда в Clicked', W.errors());
  }
  {   // игроки: PlayerAdded, статы, здоровье, телепорт, сообщение
    const W = world(`Players.PlayerAdded += player =>
{
    player.SetStat("Монеты", 0);
    player.AddStat("Монеты", 5);
    player.Message($"Привет, {player.Name}!", 3);
    player.Humanoid.WalkSpeed = 24;
    player.Teleport(new Vector3(1, 2, 3));
    Debug.Log("монет " + player.GetStat("Монеты"));
};
script.Parent.Touched += (hit, player) => player.Humanoid.Health = 0;`);
    const pc = W.of('player');
    ok(pc.some(m => m.cmd === 'stat' && m.v.k === 'Монеты' && m.v.v === 5) && pc.some(m => m.cmd === 'message' && m.v.text === 'Привет, Тест!') && pc.some(m => m.cmd === 'walk' && m.v === 24) &&
      pc.some(m => m.cmd === 'teleport' && m.v.join() === '1,2,3'), 'PlayerAdded: статы, сообщение, скорость, телепорт', pc);
    ok(W.prints().includes('монет 5'), 'GetStat');
    W.ev('touched', { id: 'a' });
    ok(W.of('player').some(m => m.cmd === 'health' && m.v === 0), 'Health = 0 — смерть');
  }
  {   // классы: OnTouched / OnTouchEnded / OnClicked / OnPlayerAdded / OnTriggerEnter(Collider)
    const W = world(`public class Trap : Script
{
    public int damage = 25;
    void OnTouched(Part hit, Player player) { player.Humanoid.TakeDamage(damage); Debug.Log("ай " + hit.Name); }
    void OnTouchEnded(Player player) { Debug.Log("ушёл " + player.Name); }
    void OnClicked(Player player) { Debug.Log("клик " + player.Name); }
    void OnPlayerAdded(Player p) { Debug.Log("пришёл " + p.Name); }
}
public class Unity : MonoBehaviour
{
    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("Player")) Debug.Log("игрок " + other.name + " " + other.gameObject.CompareTag("Player") + " " + other.tag);
    }
}`);
    W.ev('touched', { id: 'a' }); W.ev('touchEnded', { id: 'a' }); W.ev('clicked', { id: 'a' });
    ok(JSON.stringify(W.prints()) === '["пришёл Тест","ай Тест","игрок Тест True Player","ушёл Тест","клик Тест"]', 'OnTouched / OnTriggerEnter / OnTouchEnded / OnClicked / OnPlayerAdded', [W.prints(), W.errors()]);
    ok(W.of('player').some(m => m.cmd === 'health' && m.v === 75), 'TakeDamage(25)');
  }
  {   // -= у события детали методом класса
    const W = world(`public class Once : Script
{
    void Start() { Parent.Touched += Hit; }
    void Hit(Part h, Player p) { Debug.Log("раз"); Parent.Touched -= Hit; }
}`);
    W.ev('touched', { id: 'a' }); W.ev('touched', { id: 'a' });
    ok(JSON.stringify(W.prints()) === '["раз"]', 'Touched -= метод — отписка', W.prints());
  }
  {   // Instance.new, Debris, Clone/Instantiate, FindFirstChild вглубь
    const W = world(`var p = Instance.new("Part", workspace);
p.Name = "Новая";
p.Position = new Vector3(1, 2, 3);
p.Color = Color.green;
p.Material = "neon";
Debris.AddItem(p, 0.02f);
var win = workspace.FindFirstChild("Окно", true);
Debug.Log(win.Name + " в " + win.Parent.Name);
var copy = Instantiate(script.Parent, new Vector3(5, 0, 0));
Debug.Log(copy.Position.x);`);
    const nw = W.of('new')[0];
    ok(nw && W.of('set').some(m => m.id === nw.id && m.k === 'pos' && m.v.join() === '1,2,3') && W.of('set').some(m => m.id === nw.id && m.k === 'color' && m.v === '#00ff00'), 'Instance.new + свойства');
    ok(W.of('clone').length === 1 && W.prints().join('|') === 'Окно в Дом|5', 'FindFirstChild вглубь, Instantiate(деталь, позиция)', W.prints());
    await sleep(40);
    ok(W.of('destroy').some(m => m.id === nw.id), 'Debris.AddItem — исчезла');
  }
  {   // Unity: transform / gameObject / Destroy / Invoke
    const W = world(`public class U : MonoBehaviour
{
    int n;
    void Start()
    {
        transform.position += Vector3.up;
        transform.Translate(0, 0, 2);
        transform.Rotate(0, 90, 0);
        transform.Translate(0, 0, 1);
        Debug.Log(transform.position + " " + transform.eulerAngles.y + " " + gameObject.name);
        gameObject.SetActive(false);
        Debug.Log(gameObject.activeSelf + " " + Parent.Transparency);
        gameObject.SetActive(true);
        Invoke("Later", 0.01f);
        InvokeRepeating("Tick", 0.01f, 0.01f);
    }
    void Later() { Debug.Log("later"); }
    void Tick() { n++; if (n == 3) { CancelInvoke("Tick"); Debug.Log("tick3 " + IsInvoking("Tick")); Destroy(gameObject); } }
}`);
    ok(W.prints()[0] === '(1.00, 2.00, 2.00) 90 Деталь' && W.prints()[1] === 'False 1', 'transform.position/Translate/Rotate, SetActive(false)', W.prints());
    ok(W.of('set').some(m => m.id === 'a' && m.k === 'collide' && m.v === false) && W.of('set').filter(m => m.id === 'a' && m.k === 'alpha').pop().v === 0, 'SetActive: прячет и возвращает');
    await sleep(80);
    ok(W.prints().includes('later') && W.prints().includes('tick3 False') && W.of('destroy').some(m => m.id === 'a'), 'Invoke, InvokeRepeating, CancelInvoke, Destroy(gameObject)', [W.prints(), W.errors()]);
  }
  {   // деталь уничтожена → Update стоп, OnDestroy
    const W = world(`public class S : Script
{
    int n;
    void Update() { n++; if (n == 2) Parent.Destroy(); }
    void OnDestroy() { Debug.Log("OnDestroy " + n); }
}`);
    W.tick(0.1, 5);
    ok(JSON.stringify(W.prints()) === '["OnDestroy 2"]' && !W.errors().length, 'деталь удалена — Update больше не идёт, OnDestroy', [W.prints(), W.errors()]);
  }
  {   // два скрипта C# и один JS в одном мире; GetComponent / FindObjectOfType
    const W = world([
      { name: 'js', parent: 'a', code: "print('js тут');" },
      { name: 'health', parent: 'a', lang: 'cs', code: 'public class Health : Script { public int hp = 100; public void Hit(int d) { hp -= d; } }' },
      { name: 'trap', parent: 'a', lang: 'cs', code: 'public class Trap : Script { void Start() { var h = GetComponent<Health>(); h.Hit(30); Debug.Log("hp " + h.hp + " " + (FindObjectOfType<Health>() == h)); } }' },
    ]);
    await sleep(5);
    ok(W.prints().includes('js тут') && W.prints().includes('hp 70 True') && !W.errors().length, 'JS + два C#: GetComponent<T>(), FindObjectOfType<T>()', [W.prints(), W.errors()]);
  }
  {   // класс из скрипта НИЖЕ по списку: перевод ждёт, пока переведутся остальные; уже вошедший игрок — тоже PlayerAdded
    const W = world([
      { name: 'coin', parent: 'a', lang: 'cs', code: 'public class Coin : Script { void OnTouched(Part h, Player p) { GameManager.Instance.Add(p, 10); } void OnPlayerAdded(Player p) { Debug.Log("coin видит " + p.Name); } }' },
      { name: 'gm', parent: null, lang: 'cs', code: 'public class GameManager : Script\n{\n    public static GameManager Instance;\n    public int total;\n    void Awake() { Instance = this; }\n    public void Add(Player p, int n) { total += n; p.AddStat("Очки", n); Debug.Log("всего " + total / 3); }\n}' },
    ]);
    await sleep(5);
    W.ev('touched', { id: 'a' });
    ok(W.prints().includes('coin видит Тест') && W.prints().includes('всего 3') && W.of('player').some(m => m.cmd === 'stat' && m.v.k === 'Очки' && m.v.v === 10) && !W.errors().length,
      'класс из другого скрипта (ниже): GameManager.Instance, int-деление, поздний PlayerAdded', [W.prints(), W.errors()]);
  }
  {   // опечатка в имени всё равно ловится — после ожидания
    const W = world('int a = 1;\nDebug.Log(Nope.Value);');
    await sleep(5);
    ok(W.errors().length === 1 && W.errors()[0].line === 2 && /Nope/.test(W.errors()[0].msg), 'неизвестное имя — ошибка со строкой и после ожидания', W.errors());
  }
  {   // наследование Script-класса из другого скрипта: Parent — свой
    const W = world([
      { name: 'base', parent: 'b', lang: 'cs', code: 'public class Pickup : Script { public virtual int Points => 1; void OnTouched(Part h, Player p) { p.AddStat("Очки", Points); Debug.Log(Parent.Name + " +" + Points); } }' },
      { name: 'gem', parent: 'a', lang: 'cs', code: 'public class Gem : Pickup { public override int Points => 5; }' },
    ]);
    await sleep(5);
    W.ev('touched', { id: 'a' }); W.ev('touched', { id: 'b' });
    ok(JSON.stringify(W.prints()) === '["Деталь +5","Пол +1"]' && !W.errors().length, 'наследник Script-класса из другого скрипта — со своим Parent', [W.prints(), W.errors()]);
  }
  {   // OnTouched у скрипта без детали — понятная ошибка
    const W = world('public class S : Script { void OnTouched(Part h, Player p) { } }', { parent: null });
    ok(W.errors().some(e => /внутрь детали/.test(e.msg)), 'OnTouched в Workspace — подсказка', W.errors());
  }
  {   // gui, sound, Debug.LogWarning / LogError
    const W = world(`gui.message("Старт!", 2);
gui.text("счёт", "Очки: " + 5);
sound.play("coin", script.Parent);
Debug.LogWarning("осторожно");
Debug.LogError("плохо");`);
    ok(W.of('gui').some(m => m.cmd === 'message' && m.text === 'Старт!') && W.of('gui').some(m => m.cmd === 'text' && m.text === 'Очки: 5') && W.of('sound').some(m => m.name === 'coin'), 'gui и sound');
    ok(W.msgs.some(m => m.t === 'print' && m.kind === 'warn' && m.text === 'осторожно') && W.msgs.some(m => m.t === 'print' && m.kind === 'err' && m.text === 'плохо'), 'Debug.LogWarning / LogError');
  }

  // ═══ Примеры из списка «📚 Примеры…» ═══
  for (const [title, code] of L.examples) {
    let e = null;
    try { compile(code); } catch (x) { e = x; }
    ok(!e, 'пример переводится: ' + title, e && e.line + ': ' + e.message);
    const W = world(code, { objs: [part('a', 'Деталь'), part('b', 'Пол', { pos: [0, 0, 0] })] });
    W.ev('touched', { id: 'a' }); W.ev('prompt', { id: 'a' }); W.tick(0.1, 3);
    await sleep(5);
    ok(!W.errors().length, 'пример работает: ' + title, W.errors());
  }

  // ═══ Библиотека: всё, что знает переводчик, есть в песочнице ═══
  {
    const W = world('Debug.Log(1);');
    const A = W.ctx.D37Lang.cs.api(), T = W.ctx.D37Lang.cs.table();
    const per = new Set(['script', 'Parent', 'task', 'StartCoroutine', 'StopCoroutine', 'StopAllCoroutines']);
    const miss = [];
    for (const [n, d] of Object.entries(T)) {
      if (per.has(n)) continue;
      if (!(n in A)) { miss.push(n); continue; }
      for (const m of Object.keys(d.s || {})) if (!(m in A[n])) miss.push(n + '.' + m);
    }
    ok(miss.length === 0, 'каждое имя библиотеки есть в песочнице', miss);
  }

  //@@MORE4@@
  await sleep(50);
  console.log(`\n${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);   // в примерах бесконечные корутины и таймеры — ждать их не нужно
}
main().catch(e => { console.log('ТЕСТ УПАЛ', e && e.stack || e); process.exit(1); });

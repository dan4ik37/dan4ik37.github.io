// Тесты Java для «Студии 3D» (js/engine/lang-java.js): перевод Java → JavaScript и запуск в песочнице скриптов (runtime из
// js/engine/script.js) без браузера — как scripts/lang-cs-test.cjs. Проверяются: числа ровно как в Java (int/long/float/double/char,
// печать Double.toString), строки, классы, интерфейсы, enum, record, обобщения, лямбды, коллекции и стримы (порядок HashMap/HashSet
// как в Java), исключения, ошибки по-русски со строкой Java, события мира (Touched, Prompt, Tween, Heartbeat, PlayerAdded),
// классы extends Script (start/update/onTouched …), wait()/Thread.sleep как сопрограммы, примеры из «📚 Примеры…».
// Запуск из корня сайта: node scripts/lang-java-test.cjs        (подробно: JAVA_VERBOSE=1)
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/script.js'), 'utf8'), { filename: 'script.js' });
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/lang-java.js'), 'utf8'), { filename: 'lang-java.js' });
delete globalThis.window;
const E = globalThis.D37E, L = E.langs.java;
const LIB = '(' + L.worker.toString() + ')();';
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (process.env.JAVA_VERBOSE) console.log(cond ? 'ок  ' : 'НЕТ ', name); if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// переводчик отдельно (без мира)
const CC = vm.createContext({ console, setTimeout, clearTimeout });
vm.runInContext(LIB, CC);
const compile = (code, mode) => CC.D37Lang.java.compile(code, mode);
// мир: песочница скриптов с деталями и игроком; сообщения хозяину (print, error, set, tween, player …)
const part = (id, name, extra = {}) => ({ id, cls: 'Part', parent: null, p: { name, pos: [0, 1, 0], size: [4, 1, 2], rot: [0, 0, 0], color: '#a3a2a5', mat: 'plastic', alpha: 0, collide: true, anchored: true, ...extra } });
function world(code, o = {}){
  const msgs = [];
  const ctx = vm.createContext({ postMessage: m => msgs.push(JSON.parse(JSON.stringify(m))), onmessage: null, setTimeout, clearTimeout, console });
  vm.runInContext('(' + E.scripts.runtime.toString() + ')()', ctx);
  const send = d => ctx.onmessage({ data: d });
  const objs = o.objs || [part('a', 'Деталь'), part('b', 'Пол', { pos: [0, 0, 0] }), { id: 'm', cls: 'Model', parent: null, p: { name: 'Дом' } }, { ...part('c', 'Окно'), parent: 'm' }];
  const scripts = (Array.isArray(code) ? code : [code]).map((c, i) => typeof c === 'string' ? { name: 'java' + (i || ''), parent: o.parent === undefined ? 'a' : o.parent, lang: 'java', code: c } : c);
  send({ t: 'init', players: o.players || [{ id: 'me', name: 'Тест', pos: [0, 0, 0] }], objs, scripts, libs: { java: LIB } });
  return {
    msgs, send, ctx,
    prints: () => msgs.filter(m => m.t === 'print').map(m => m.text),
    errors: () => msgs.filter(m => m.t === 'error'),
    of: t => msgs.filter(m => m.t === t),
    tick(dt = 0.1, n = 1){ for (let i = 0; i < n; i++) send({ t: 'tick', dt }); },
    ev(ev, d = {}){ send({ t: 'ev', ev, player: 'me', ...d }); },
  };
}
async function out(title, code, want, o = {}){   // вывод System.out.println
  const W = world(code, o);
  await sleep(o.wait || 2);
  if (o.act) { o.act(W); await sleep(o.wait2 || 2); }
  if (o.ticks) { W.tick(o.dt || 0.1, o.ticks); await sleep(o.wait2 || 2); }
  const got = W.prints(), errs = W.errors().map(e => e.line + ': ' + e.msg);
  const wantL = typeof want === 'string' ? want.split('\n') : want;
  ok(!errs.length && JSON.stringify(got) === JSON.stringify(wantL), title, { got, errs });
  return W;
}
function cerr(title, code, line, re, mode){   // ошибка перевода: строка и текст
  let e = null;
  try { compile(code, mode); } catch (x) { e = x; }
  ok(e && e.java && e.line === line && re.test(e.message), title, e ? { line: e.line, msg: e.message, java: !!e.java } : 'нет ошибки');
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
  ok(L && L.id === 'java' && L.label === 'Java (как в модах Minecraft)' && L.short === 'Java' && L.icon === '☕' && L.kind === 'text', 'язык java зарегистрирован');
  ok(typeof L.worker === 'function' && L.examples.length >= 10 && /Задача: $/.test(L.ai) && /extends Script/.test(L.ai) && L.placeholder, 'примеры, задание для ИИ, подсказка');
  ok(typeof CC.D37Lang.java.run === 'function' && typeof CC.D37Lang.java.compile === 'function' && typeof CC.D37Lang.java.mapLine === 'function', 'D37Lang.java в песочнице');
  {
    const gj = fs.readFileSync(path.join(SITE, 'js/features/games.js'), 'utf8');
    ok(/'js\/engine\/lang-cs\.js', 'js\/engine\/lang-java\.js'/.test(gj), 'lang-java.js подключён к «Студии 3D» (games.js)');
  }

  // ═══ Числа: ровно как в Java ═══
  await out('int: деление к нулю, остаток со знаком делимого', `int a = 7, b = 2;
System.out.println(a / b);
System.out.println(a % b);
System.out.println(-7 / 2);
System.out.println(7 / -2 + " " + 7 % -2 + " " + -7 % 2);
System.out.println(Math.floorDiv(-7, 2) + " " + Math.floorMod(-7, 2));`, ['3', '1', '-3', '-3 1 -1', '-4 1']);
  await out('double печатается как Double.toString', `System.out.println(7.0 / 2);
double d = 5;
System.out.println(d);
System.out.println(0.1 + 0.2);
System.out.println(1e10 + " " + 100.0 + " " + 1e-5 + " " + 123456789.0);
System.out.println(0.001 + " " + 0.0001 + " " + 1e7 + " " + 1e6 + " " + 100.0 / 3);
System.out.println(1.0 / 0 + " " + -1.0 / 0 + " " + (0.0 / 0 == 0.0 / 0) + " " + Double.isNaN(0.0 / 0));`,
  ['3.5', '5.0', '0.30000000000000004', '1.0E10 100.0 1.0E-5 1.23456789E8', '0.001 1.0E-4 1.0E7 1000000.0 33.333333333333336', 'Infinity -Infinity false true']);
  await out('float — 32 бита (Float.toString)', `float f = 0.1f + 0.2f;
System.out.println(f);
System.out.println(1.1f * 1.1f);
System.out.println(1f / 3f);
System.out.println((double) 0.1f);
System.out.println((float) 1e7 + " " + 3.0e-5f + " " + (0.1f + 0.7f));`, ['0.3', '1.21', '0.33333334', '0.10000000149011612', '1.0E7 3.0E-5 0.8']);
  await out('переполнение int, long — точные 64 бита', `System.out.println(Integer.MAX_VALUE + 1);
System.out.println(Integer.MAX_VALUE * 2 + " " + 46341 * 46341 + " " + (long) 46341 * 46341 + " " + Math.abs(Integer.MIN_VALUE));
long big = 1L << 40;
System.out.println(big);
long fact = 1; for (int i = 2; i <= 20; i++) fact *= i;
System.out.println(fact + " " + Long.MAX_VALUE + " " + (Long.MAX_VALUE + 1));
System.out.println(Long.MIN_VALUE / -1 + " " + (1 << 33) + " " + (1L << 33));`,
  ['-2147483648', '-2 -2147479015 2147488281 -2147483648', '1099511627776', '2432902008176640000 9223372036854775807 -9223372036854775808', '-9223372036854775808 2 8589934592']);
  await out('char — число и знак', `char c = 'a';
System.out.println(c + 1);
System.out.println((char) (c + 1));
System.out.println("x" + c + 1);
char d = 'A'; d += 2; d++;
System.out.println(d + " " + (int) d + " " + ('a' + 'b') + " " + (char) ('a' + 1));
for (char ch = 'a'; ch <= 'e'; ch++) System.out.print(ch);
System.out.println();`, ['98', 'b', 'xa1', 'D 68 195 b', 'abcde']);
  await out('приведения: к нулю, с насыщением, byte/short', `System.out.println((int) 3.99 + " " + (int) -7.9 + " " + (int) 3.99e10 + " " + (int) Double.NaN);
System.out.println((long) -1e30 + " " + (long) 1e19 + " " + (long) 2.9);
byte by = 120; by += 10;
short sh = (short) 70000;
System.out.println(by + " " + sh + " " + (byte) 200 + " " + (int) 'Я');`, ['3 -7 2147483647 0', '-9223372036854775808 9223372036854775807 2', '-126 4464 -56 1071']);
  await out('битовые операции и сдвиги', `System.out.println((-17 >> 2) + " " + (-17 >>> 28) + " " + (5 & 3) + " " + (5 | 3) + " " + (5 ^ 3) + " " + (~5));
System.out.println((-1L >>> 60) + " " + (1L << 63) + " " + Integer.bitCount(255) + " " + Long.numberOfTrailingZeros(8L));`, ['-5 15 1 7 6 -6', '15 -9223372036854775808 8 3']);
  await out('Math.round, ceil, floor, pow, sqrt', `System.out.println(Math.round(-2.5) + " " + Math.round(2.5) + " " + Math.round(-2.6f) + " " + Math.round(2.4f));
System.out.println(Math.ceil(1.2) + " " + Math.floor(-1.2) + " " + Math.pow(2, 10) + " " + Math.sqrt(2));
System.out.println(Math.max(3, 7) + " " + Math.max(3, 7.5) + " " + Math.abs(-4) + " " + Math.abs(-4.5) + " " + Math.hypot(3, 4));`,
  ['-2 3 -3 2', '2.0 -2.0 1024.0 1.4142135623730951', '7 7.5 4 4.5 5.0']);
  await out('деление на ноль — ArithmeticException', `try { System.out.println(1 / 0); } catch (ArithmeticException e) { System.out.println("поймал " + e.getClass().getSimpleName()); }
try { long z = 0; System.out.println(5L % z); } catch (ArithmeticException e) { System.out.println("и long"); }
System.out.println(5.0 / 0);`, ['поймал ArithmeticException', 'и long', 'Infinity']);
  await out('Integer: кэш ==, equals, разбор и печать', `Integer i1 = 127, i2 = 127, i3 = 1000, i4 = 1000;
System.out.println((i1 == i2) + " " + i3.equals(i4) + " " + Integer.toBinaryString(10) + " " + Integer.toHexString(-1) + " " + Integer.parseInt("ff", 16) + " " + Long.parseLong("-123456789012"));
System.out.println(Integer.valueOf(5).hashCode() + " " + Double.compare(1.5, 2.5) + " " + Integer.MIN_VALUE + " " + Double.parseDouble("2.50"));
try { Integer.parseInt("12a"); } catch (NumberFormatException e) { System.out.println("не число"); }`,
  ['true true 1010 ffffffff 255 -123456789012', '5 -1 -2147483648 2.5', 'не число']);
  await out('Math.*Exact и прочее', `System.out.println(Math.ulp(1.0) + " " + Math.fma(2.0, 3.0, 1.0) + " " + Math.clamp(5, 1, 3) + " " + Math.ceilDiv(7, 2) + " " + Math.signum(-3.0) + " " + Math.toDegrees(Math.PI));
try { Math.addExact(Integer.MAX_VALUE, 1); } catch (ArithmeticException e) { System.out.println("переполнение"); }
System.out.println(Math.multiplyExact(100000L, 100000L) + " " + Math.toIntExact(5L) + " " + Math.subtractExact(5, 7));`,
  ['2.220446049250313E-16 7.0 3 4 -1.0 180.0', 'переполнение', '10000000000 5 -2']);
  await out('Random с зерном — те же числа, что в Java', `Random rnd = new Random(42);
System.out.println(rnd.nextInt() + " " + new Random(42).nextDouble() + " " + new Random(0).nextInt());
Random r2 = new Random(42);
System.out.println(r2.nextInt(100) + " " + r2.nextInt(100) + " " + r2.nextInt(10));
System.out.println(new Random(42).nextInt(10) + " " + new Random(42).nextLong());`, ['-1170105035 0.7275636800328681 -1155484576', '30 63 8', '0 -5025562857975149833']);

  // ═══ Строки ═══
  await out('String, StringBuilder, format', `String s = "Hello";
System.out.println(s.length() + " " + s.charAt(1) + " " + s.toUpperCase() + " " + s.substring(1, 3) + " " + s.indexOf('l') + " " + s.contains("ell"));
StringBuilder sb = new StringBuilder();
for (int i = 0; i < 3; i++) sb.append(i).append(',');
System.out.println(sb);
StringBuilder sb2 = new StringBuilder("abc");
sb2.insert(0, 'z').append(1.5).reverse();
System.out.println(sb2 + " " + sb2.length());
StringBuilder sb3 = new StringBuilder("hello"); sb3.setCharAt(0, 'H'); sb3.deleteCharAt(4).insert(4, "o!").append(42).append('c').append(2.5f);
System.out.println(sb3 + " " + sb3.indexOf("o") + " " + sb3.charAt(1));
System.out.println(String.format("%5d|%-5s|%05.1f|%x|%c|%b|%,d|%.3e", 42, "hi", 3.14159, 255, 'Z', true, 1234567, 12345.678));
System.out.println(String.format("%.2f %s %08.3f %+d %o", 2.675, null, -3.5, 7, 8));`,
  ['5 e HELLO el 2 true', '0,1,2,', '5.1cbaz 7', 'Hello!42c2.5 4 e', '   42|hi   |003.1|ff|Z|true|1,234,567|1.235e+04', '2.68 null -003.500 +7 10']);
  await out('split, join, repeat, hashCode, chars', `System.out.println(String.join("-", List.of("a", "b", "c")) + " " + "a,b,,c,,".split(",").length + " " + "  trim  ".trim() + "|");
System.out.println("Hello".chars().filter(Character::isUpperCase).count() + " " + "abc".repeat(2) + " " + "x".compareTo("y") + " " + "hello".hashCode());
System.out.println("Hello".chars().sum() + " " + "a-b-c".replace("-", "+") + " " + "AbC".equalsIgnoreCase("abc") + " " + "  ".isBlank() + " " + "Привет".toLowerCase());
System.out.println(Arrays.toString("a1b2c3".split("\\\\d")) + " " + "мама мыла раму".replaceAll("м(а)", "М$1") + " " + "x".isEmpty());
String tb = """
    Привет,
      мир!
    """;
System.out.print(tb);`, ['a-b-c 4 trim|', '1 abcabc -1 99162322', '500 a+b+c true true привет', '[a, b, c] МаМа мыла раму false', 'Привет,', '  мир!']);
  await out('сравнение строк: equals, ==, switch по строке', `String a = "abc", b = new String("abc");
System.out.println(a.equals(b) + " " + (a.compareTo("abd") < 0));
String cmd = "go";
switch (cmd) { case "stop": System.out.println("стоп"); case "go": System.out.print("иду "); case "run": System.out.println("бегу"); break; default: System.out.println("?"); }`,
  ['true true', 'иду бегу']);
  await out('Character', `System.out.println(Character.isDigit('7') + " " + Character.isLetter('ж') + " " + Character.getNumericValue('9') + " " + Character.toUpperCase('ё') + " " + String.valueOf(3.0) + " " + Objects.equals(null, null));
System.out.println(Character.isWhitespace(' ') + " " + Character.isLetterOrDigit('_') + " " + (char) Character.toUpperCase((int) 'b') + " " + Character.isValidCodePoint(65));`,
  ['true true 9 Ё 3.0 true', 'true false B true']);

  // ═══ Классы: интерфейсы, абстрактные, перегрузки, enum, record, вложенные ═══
  await out('ООП целиком (интерфейсы с default/static, abstract, перегрузки, varargs, enum, record, inner/nested/анонимные, шаблоны)', `import java.util.*;

interface Shape { double area(); default String describe() { return getClass().getSimpleName() + " площадью " + String.format("%.2f", area()); } static Shape unit() { return new Square(1); } }
abstract class Base implements Shape {
    protected String name;
    static int count = 0;
    Base(String name) { this.name = name; count++; }
    @Override public String toString() { return name + "(" + area() + ")"; }
}
class Circle extends Base {
    private final double r;
    Circle(double r) { super("Круг"); this.r = r; }
    public double area() { return Math.PI * r * r; }
}
class Square extends Base {
    private final double side;
    Square(double side) { super("Квадрат"); this.side = side; }
    Square() { this(2); }
    public double area() { return side * side; }
}
enum Planet {
    MERCURY(3.303e+23, 2.4397e6), EARTH(5.976e+24, 6.37814e6);
    private final double mass, radius;
    Planet(double mass, double radius) { this.mass = mass; this.radius = radius; }
    static final double G = 6.67300E-11;
    double gravity() { return G * mass / (radius * radius); }
}
enum Op { PLUS { int apply(int a, int b) { return a + b; } }, TIMES { int apply(int a, int b) { return a * b; } }; abstract int apply(int a, int b); }
record Point(int x, int y) {
    Point { if (x < 0) throw new IllegalArgumentException("x < 0"); }
    double dist() { return Math.sqrt(x * x + y * y); }
    static Point origin() { return new Point(0, 0); }
}
public class Main {
    int counter = 10;
    class Inner { int get() { return counter * 2; } }
    static class Nested { String hi() { return "nested"; } }
    static int add(int a, int b) { return a + b; }
    static double add(double a, double b) { return a + b + 0.5; }
    static String add(String a, String b) { return a + "+" + b; }
    static int sum(int... xs) { int s = 0; for (int x : xs) s += x; return s; }
    public static void main(String[] args) {
        List<Shape> shapes = new ArrayList<>();
        shapes.add(new Circle(1));
        shapes.add(new Square(3));
        shapes.add(new Square());
        for (Shape s : shapes) System.out.println(s.describe());
        System.out.println(shapes);
        System.out.println(Base.count + " " + Shape.unit().area());
        System.out.println(add(1, 2) + " " + add(1.0, 2) + " " + add("a", "b"));
        System.out.println(sum() + " " + sum(1, 2, 3));
        for (Planet p : Planet.values()) System.out.printf("%s %.2f %d%n", p, p.gravity(), p.ordinal());
        System.out.println(Planet.valueOf("EARTH").name() + " " + Op.PLUS.apply(2, 3) + " " + Op.TIMES.apply(2, 3));
        Point p = new Point(3, 4);
        System.out.println(p + " " + p.x() + " " + p.dist() + " " + p.equals(new Point(3, 4)) + " " + (p.hashCode() == new Point(3, 4).hashCode()));
        try { new Point(-1, 0); } catch (IllegalArgumentException e) { System.out.println("ошибка: " + e.getMessage()); }
        Main m = new Main();
        Main.Inner in = m.new Inner();
        System.out.println(in.get() + " " + new Nested().hi());
        Runnable r = new Runnable() { int calls = 0; public void run() { calls++; System.out.println("анонимный " + calls); } };
        r.run(); r.run();
        Object o = p;
        if (o instanceof Point(int x, int y) && x > 0) System.out.println("запись " + x + "," + y);
        String res = switch (Planet.EARTH) { case MERCURY -> "близко"; case EARTH -> { String t = "дом"; yield t; } };
        System.out.println(res);
        Object[] things = { 1, "два", 3.5, 'c', null };
        for (Object t : things) {
            String d = switch (t) {
                case null -> "пусто";
                case Integer i when i > 0 -> "плюс " + i;
                case Integer i -> "int " + i;
                case String s -> "строка " + s.length();
                default -> "другое " + t;
            };
            System.out.println(d);
        }
    }
}`, `Circle площадью 3.14
Square площадью 9.00
Square площадью 4.00
[Круг(3.141592653589793), Квадрат(9.0), Квадрат(4.0)]
3 1.0
3 3.5 a+b
0 6
MERCURY 3.70 0
EARTH 9.80 1
EARTH 5 6
Point[x=3, y=4] 3 5.0 true true
ошибка: x < 0
20 nested
анонимный 1
анонимный 2
запись 3,4
дом
плюс 1
строка 3
другое 3.5
другое c
пусто`);
  await out('конструкторы: цепочка this(…)/super(…), порядок инициализации полей', `class A { int v = 1; A() { System.out.println("A: v=" + v + " show=" + show()); } String show() { return "A"; } }
class B extends A { int w = 5; B() { super(); System.out.println("B: w=" + w); } B(int x) { this(); w = x; } @Override String show() { return "B w=" + w; } }
B b = new B(9);
System.out.println(b.w + " " + b.v);`, ['A: v=1 show=B w=0', 'B: w=5', '9 1']);
  await out('static-инициализация и блоки инициализации', `class Cfg { static final Map<String, Integer> T = new HashMap<>(); static int n; static { T.put("a", 1); T.put("b", 2); n = T.size(); } }
class Ctr { int x; { x = 42; } }
System.out.println(Cfg.T + " " + Cfg.n + " " + new Ctr().x);`, ['{a=1, b=2} 2 42']);
  await out('обобщения: свой класс с границей, обобщённые методы, ? extends', `class Box<T extends Comparable<T>> {
    private T best;
    void offer(T x) { if (best == null || x.compareTo(best) > 0) best = x; }
    T get() { return best; }
}
<T> List<T> twice(T x) { List<T> l = new ArrayList<>(); l.add(x); l.add(x); return l; }
double total(List<? extends Number> xs) { double s = 0; for (Number n : xs) s += n.doubleValue(); return s; }
Box<String> b = new Box<>(); b.offer("груша"); b.offer("яблоко"); b.offer("абрикос");
System.out.println(b.get() + " " + twice(7) + " " + total(List.of(1, 2.5, 3L)));
Box<Integer> bi = new Box<>(); for (int v : new int[]{4, 9, 2}) bi.offer(v);
System.out.println(bi.get() + 1);`, ['яблоко [7, 7] 6.5', '10']);
  await out('Iterable своего класса в for-each, анонимный Iterator', `class Range implements Iterable<Integer> {
    final int lo, hi;
    Range(int lo, int hi) { this.lo = lo; this.hi = hi; }
    public Iterator<Integer> iterator() {
        return new Iterator<>() {
            int cur = lo;
            public boolean hasNext() { return cur < hi; }
            public Integer next() { return cur++; }
        };
    }
}
int sum = 0; for (int v : new Range(1, 5)) sum += v;
System.out.println("range " + sum);`, ['range 10']);
  await out('equals/hashCode/compareTo своего класса в HashSet, TreeSet, сортировке', `class Card implements Comparable<Card> {
    final String suit; final int rank;
    Card(String s, int r) { suit = s; rank = r; }
    @Override public boolean equals(Object o) { return o instanceof Card c && c.suit.equals(suit) && c.rank == rank; }
    @Override public int hashCode() { return Objects.hash(suit, rank); }
    @Override public int compareTo(Card o) { return rank != o.rank ? Integer.compare(rank, o.rank) : suit.compareTo(o.suit); }
    @Override public String toString() { return suit + rank; }
}
Set<Card> cards = new HashSet<>(List.of(new Card("♠", 10), new Card("♥", 3)));
System.out.println(cards.contains(new Card("♠", 10)) + " " + new TreeSet<>(cards));
List<Card> hand = new ArrayList<>(List.of(new Card("b", 5), new Card("a", 5), new Card("c", 2)));
Collections.sort(hand);
System.out.println(hand);`, ['true [♥3, ♠10]', '[c2, a5, b5]']);
  await out('свои исключения, try-with-resources, multi-catch, finally', `class GameException extends Exception { final int code; GameException(String msg, int code) { super(msg); this.code = code; } }
class Res implements AutoCloseable { final String n; Res(String n) { this.n = n; System.out.println("open " + n); } public void close() { System.out.println("close " + n); } }
void risky(int x) throws GameException { if (x > 2) throw new GameException("слишком много: " + x, x); }
try { risky(1); risky(5); } catch (GameException e) { System.out.println(e.getMessage() + " код " + e.code); }
try (Res r1 = new Res("A"); Res r2 = new Res("B")) { System.out.println("внутри " + r1.n + r2.n); }
try { throw new IllegalStateException("плохо"); } catch (IllegalArgumentException | IllegalStateException e) { System.out.println(e); }
try { Integer.parseInt("abc"); } catch (NumberFormatException e) { System.out.println("nfe"); } finally { System.out.println("finally"); }
int f() { try { return 1; } finally { System.out.println("finally перед return"); } }
System.out.println(f());`, ['слишком много: 5 код 5', 'open A', 'open B', 'внутри AB', 'close B', 'close A', 'java.lang.IllegalStateException: плохо', 'nfe', 'finally', 'finally перед return', '1']);
  await out('метки break/continue, do-while, тернарные цепочки', `outer:
for (int i = 0; i < 4; i++) {
    for (int j = 0; j < 4; j++) {
        if (j == 2) continue outer;
        if (i == 3) break outer;
        System.out.print(i + "" + j + " ");
    }
}
System.out.println();
int k = 0; do { k += 3; } while (k < 10); System.out.println("do " + k);
int n = 15;
System.out.println(n % 15 == 0 ? "FizzBuzz" : n % 3 == 0 ? "Fizz" : n % 5 == 0 ? "Buzz" : String.valueOf(n));`, ['00 01 10 11 20 21 ', 'do 12', 'FizzBuzz']);
  await out('enum: values() внутри enum, EnumMap, switch со стрелками, valueOf с ошибкой', `enum Dir { NORTH, EAST, SOUTH, WEST; Dir turn() { return values()[(ordinal() + 1) % values().length]; } }
EnumMap<Dir, String> em = new EnumMap<>(Dir.class); em.put(Dir.WEST, "w"); em.put(Dir.NORTH, "n");
System.out.println(em + " " + Dir.valueOf("EAST").turn() + " " + Dir.NORTH.compareTo(Dir.WEST));
try { Dir.valueOf("UP"); } catch (IllegalArgumentException e) { System.out.println("нет такого"); }
Dir d = Dir.SOUTH;
switch (d) { case NORTH, SOUTH -> System.out.println("вертикаль"); default -> System.out.println("горизонталь"); }`,
  ['{NORTH=n, WEST=w} SOUTH -3', 'нет такого', 'вертикаль']);
  await out('интерфейс: private-метод, default вызывает абстрактный, Comparable у enum', `interface Greeter { String name(); default String hello() { return wrap("Привет, " + name()); } private String wrap(String s) { return "[" + s + "]"; } }
record Kid(String name) implements Greeter {}
System.out.println(new Kid("Аня").hello());
enum Size { S, M, L }
List<Size> ss = new ArrayList<>(List.of(Size.L, Size.S, Size.M)); Collections.sort(ss); System.out.println(ss);`, ['[Привет, Аня]', '[S, M, L]']);
  await out('instanceof с шаблоном, var, лямбда меняет массив, захват', `Object o = 42; String desc = o instanceof Integer n && n > 40 ? "большое " + n : "другое"; System.out.println(desc);
int[] counter = new int[1]; Runnable inc = () -> counter[0]++; inc.run(); inc.run(); System.out.println("счётчик " + counter[0]);
var list = new ArrayList<String>(); list.add("x"); var first = list.get(0); System.out.println(first.toUpperCase());`, ['большое 42', 'счётчик 2', 'X']);

  // ═══ Коллекции и стримы ═══
  await out('коллекции и стримы целиком (порядок HashMap/HashSet и PriorityQueue как в Java)', `import java.util.*;
import java.util.function.*;
import java.util.stream.*;

public class Main {
    record Person(String name, int age, double score) {}
    public static void main(String[] args) {
        List<Integer> nums = new ArrayList<>(List.of(5, 3, 8, 1, 9, 2));
        Collections.sort(nums);
        System.out.println(nums + " " + nums.size() + " " + nums.get(0) + " " + nums.contains(8) + " " + nums.indexOf(9));
        nums.remove(Integer.valueOf(8));
        nums.remove(0);
        System.out.println(nums);
        Map<String, Integer> counts = new HashMap<>();
        for (String w : "the quick brown fox jumps over the lazy dog the end".split(" ")) counts.merge(w, 1, Integer::sum);
        System.out.println(counts);
        Map<String, Integer> tm = new TreeMap<>(counts);
        System.out.println(tm + " " + ((TreeMap<String, Integer>) tm).firstKey());
        Set<String> hs = new HashSet<>(List.of("banana", "apple", "cherry", "date"));
        System.out.println(hs);
        Set<Integer> ts = new TreeSet<>(Arrays.asList(5, 1, 4, 1, 3));
        System.out.println(ts);
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(1); stack.push(2); stack.push(3);
        System.out.println(stack.pop() + " " + stack.peek() + " " + stack);
        Queue<String> q = new LinkedList<>();
        q.offer("a"); q.offer("b"); System.out.println(q.poll() + q.size());
        PriorityQueue<Integer> pq = new PriorityQueue<>(List.of(5, 1, 8, 3, 2));
        System.out.println(pq + " " + pq.poll() + " " + pq);
        List<Person> people = List.of(new Person("Аня", 12, 4.5), new Person("Боря", 10, 3.0), new Person("Вика", 12, 5.0), new Person("Гена", 11, 4.0));
        System.out.println(people.stream().filter(p -> p.age() > 10).map(Person::name).collect(Collectors.toList()));
        System.out.println(people.stream().mapToInt(Person::age).sum() + " " + people.stream().mapToDouble(Person::score).average().getAsDouble());
        System.out.println(people.stream().collect(Collectors.groupingBy(Person::age, Collectors.counting())));
        System.out.println(people.stream().sorted(Comparator.comparing(Person::score).reversed()).map(Person::name).collect(Collectors.joining(", ", "[", "]")));
        System.out.println(IntStream.rangeClosed(1, 5).map(x -> x * x).boxed().collect(Collectors.toList()));
        System.out.println(Stream.iterate(1, x -> x * 2).limit(10).reduce(0, Integer::sum));
        System.out.println(people.stream().max(Comparator.comparingInt(Person::age)).get().name());
        System.out.println(DoubleStream.of(0.1, 0.2, 0.3).sum() + " " + (0.1 + 0.2 + 0.3));
        Optional<String> first = people.stream().map(Person::name).filter(n -> n.startsWith("В")).findFirst();
        System.out.println(first + " " + first.isPresent() + " " + Optional.empty().orElse("нет"));
        Function<Integer, Integer> twice = x -> x * 2;
        Function<Integer, Integer> plus3 = x -> x + 3;
        System.out.println(twice.andThen(plus3).apply(5) + " " + twice.compose(plus3).apply(5));
        Predicate<String> empty = String::isEmpty;
        System.out.println(empty.negate().test("") + " " + empty.test(""));
        Supplier<List<String>> sup = ArrayList::new;
        List<String> made = sup.get(); made.add("x"); System.out.println(made);
        BiFunction<Integer, Integer, Integer> mul = (a, b) -> a * b;
        System.out.println(mul.apply(6, 7));
        int[] arr = {5, 2, 9, 1};
        Arrays.sort(arr);
        System.out.println(Arrays.toString(arr) + " " + arr.length + " " + Arrays.stream(arr).max().getAsInt());
        double[] ds = new double[3]; ds[1] = 2.5;
        System.out.println(Arrays.toString(ds));
        String[][] grid = new String[2][3];
        grid[1][2] = "X";
        System.out.println(Arrays.deepToString(grid));
        Iterator<Integer> itr = nums.iterator();
        while (itr.hasNext()) if (itr.next() % 2 == 0) itr.remove();
        System.out.println(nums);
        try { for (Integer n : nums) if (n == 3) nums.remove(n); } catch (ConcurrentModificationException e) { System.out.println("CME!"); }
        try { List.of(1).add(2); } catch (UnsupportedOperationException e) { System.out.println("неизменяемый"); }
        try { int[] a = new int[2]; a[5] = 1; } catch (ArrayIndexOutOfBoundsException e) { System.out.println("индекс"); }
        try { Object o = "s"; Integer i = (Integer) o; } catch (ClassCastException e) { System.out.println("cast"); }
        Map<Character, Integer> freq = new TreeMap<>();
        for (char ch : "abracadabra".toCharArray()) freq.put(ch, freq.getOrDefault(ch, 0) + 1);
        System.out.println(freq);
        List<Double> dl = new ArrayList<>(); dl.add(1.0); dl.add(2.5);
        System.out.println(dl + " " + Map.of("k", 1.0));
    }
}`, `[1, 2, 3, 5, 8, 9] 6 1 true 5
[2, 3, 5, 9]
{the=3, over=1, quick=1, lazy=1, jumps=1, end=1, brown=1, dog=1, fox=1}
{brown=1, dog=1, end=1, fox=1, jumps=1, lazy=1, over=1, quick=1, the=3} brown
[banana, date, apple, cherry]
[1, 3, 4, 5]
3 2 [2, 1]
a1
[1, 2, 8, 3, 5] 1 [2, 3, 8, 5]
[Аня, Вика, Гена]
45 4.125
{10=1, 11=1, 12=2}
[Вика, Аня, Гена, Боря]
[1, 4, 9, 16, 25]
1023
Аня
0.6 0.6000000000000001
Optional[Вика] true нет
13 16
false true
[x]
42
[1, 2, 5, 9] 4 9
[0.0, 2.5, 0.0]
[[null, null, null], [null, null, X]]
[3, 5, 9]
CME!
неизменяемый
индекс
cast
{a=5, b=2, c=1, d=1, r=2}
[1.0, 2.5] {k=1.0}`);
  await out('массивы: зубчатые, clone, fill, asList, сортировка с компаратором', `int[][] jag = new int[3][]; jag[0] = new int[]{1}; jag[1] = new int[]{1, 2}; jag[2] = new int[0];
int[] cl = jag[1].clone(); cl[0] = 9; int[] filled = new int[4]; Arrays.fill(filled, 7);
System.out.println(Arrays.deepToString(jag) + " " + Arrays.toString(cl) + " " + jag[1][0] + " " + Arrays.toString(filled));
List<String> fixed = Arrays.asList("x", "y"); fixed.set(0, "z");
try { fixed.add("w"); } catch (UnsupportedOperationException e) { System.out.println("asList " + fixed); }
String[] words = {"банан", "яблоко", "киви"};
Arrays.sort(words, (a, b) -> a.length() - b.length());
System.out.println(String.join(",", words) + " " + Arrays.binarySearch(new int[]{1, 3, 5, 7}, 5) + " " + Arrays.equals(new int[]{1}, new int[]{1}));`,
  ['[[1], [1, 2], []] [9, 2] 1 [7, 7, 7, 7]', 'asList [z, y]', 'киви,банан,яблоко 2 true']);
  await out('функциональные интерфейсы: andThen у Consumer, maxBy, UnaryOperator, identity', `Consumer<List<Integer>> addOne = l -> l.add(1);
Consumer<List<Integer>> both = addOne.andThen(l -> l.add(2));
List<Integer> li = new ArrayList<>(); both.accept(li); System.out.println(li);
BinaryOperator<Integer> mx = BinaryOperator.maxBy(Comparator.naturalOrder());
UnaryOperator<String> up = String::toUpperCase;
System.out.println(mx.apply(3, 9) + " " + up.apply("abc") + " " + Function.<Integer>identity().apply(5));
var es = new ArrayList<Map.Entry<String, Integer>>(Map.of("a", 1, "b", 2).entrySet());
es.sort(Map.Entry.comparingByValue(Comparator.reverseOrder()));
System.out.println(es + " " + es.get(0).getKey());`, ['[1, 2]', '9 ABC 5', '[b=2, a=1] b']);
  await out('стримы: flatMap, distinct, partitioningBy, toMap, IntStream.range, anyMatch', `List<List<Integer>> ll = List.of(List.of(1, 2), List.of(2, 3), List.of(4));
System.out.println(ll.stream().flatMap(List::stream).distinct().map(String::valueOf).collect(Collectors.joining("+")));
System.out.println(IntStream.range(0, 10).boxed().collect(Collectors.partitioningBy(x -> x % 3 == 0)));
Map<String, Integer> lens = Stream.of("кот", "собака", "ёж").collect(Collectors.toMap(s -> s, String::length));
System.out.println(new TreeMap<>(lens) + " " + IntStream.of(3, 1, 2).sorted().boxed().toList() + " " + Stream.of(1, 2, 3).anyMatch(x -> x > 2) + " " + IntStream.rangeClosed(1, 4).reduce(1, (a, b) -> a * b));`,
  ['1+2+3+4', '{false=[1, 2, 4, 5, 7, 8], true=[0, 3, 6, 9]}', '{кот=3, собака=6, ёж=2} [1, 2, 3] true 24']);
  await out('ссылки на методы всех 4 видов', `class Counter { private int n; static int created = 0; Counter() { created++; } Counter inc() { n++; return this; } int get() { return n; } }
Function<String, Integer> parse = Integer::parseInt;
String pre = "ab";
Predicate<String> starts = pre::startsWith;
BiFunction<String, String, Boolean> eq = String::equals;
Supplier<Counter> mk = Counter::new;
Function<Integer, int[]> arr = int[]::new;
System.out.println(parse.apply("12") + 1 + " " + starts.test("abc") + " " + eq.apply("x", "x") + " " + mk.get().inc().inc().get() + " " + arr.apply(3).length + " " + Counter.created);`, ['13 false true 2 3 1']);
  await out('выбор перегрузки как в javac (расширение, упаковка, varargs)', `int f(int x) { return 1; }
int f(long x) { return 2; }
int f(Integer x) { return 3; }
int f(Object x) { return 4; }
int g(int... xs) { return 10 + xs.length; }
int g(int a, int b) { return 2; }
byte b = 1; short sh = 2; char c = 'c'; long L = 5;
Integer boxed = 7;
System.out.println(f(b) + " " + f(sh) + " " + f(c) + " " + f(L) + " " + f(boxed) + " " + f("s") + " " + f(3.0) + " " + g(1, 2) + " " + g(1) + " " + g() + " " + g(1, 2, 3));`, ['1 1 1 2 3 4 4 2 11 10 13']);
  await out('полиморфизм, super.метод(), getClass().getSimpleName()', `class Animal { String sound() { return "..."; } String speak() { return getClass().getSimpleName() + ": " + sound(); } }
class Dog extends Animal { @Override String sound() { return "Гав"; } }
class Puppy extends Dog { @Override String sound() { return super.sound() + "-гав"; } }
for (Animal a : List.of(new Animal(), new Dog(), new Puppy())) System.out.print(a.speak() + "; ");
System.out.println();`, ['Animal: ...; Dog: Гав; Puppy: Гав-гав; ']);
  await out('switch с шаблонами типов и when', `String kind(Object o) {
    return switch (o) {
        case Integer i when i < 0 -> "минус";
        case Integer i -> "целое";
        case Double d -> "дробное";
        case String s when s.isEmpty() -> "пустая";
        case String s -> "строка";
        case int[] a -> "массив " + a.length;
        default -> "что-то";
    };
}
System.out.println(kind(-5) + " " + kind(5) + " " + kind(2.5) + " " + kind("") + " " + kind("x") + " " + kind(new int[4]) + " " + kind('c'));`, ['минус целое дробное пустая строка массив 4 что-то']);
  await out('List<Integer>.remove: по индексу или по значению; equals у упакованных', `List<Integer> li = new ArrayList<>(List.of(10, 20, 30, 40));
li.remove(1); li.remove(Integer.valueOf(40));
System.out.println(li + " " + li.indexOf(30) + " " + li.contains(10));
Integer big1 = 1000, big2 = 1000;
System.out.println(big1.equals(big2) + " " + (big1.intValue() == big2));
ListIterator<Integer> lit = li.listIterator();
while (lit.hasNext()) { int v = lit.next(); if (v == 10) lit.set(11); else lit.add(99); }
System.out.println(li);`, ['[10, 30] 1 true', 'true true', '[11, 30, 99]']);
  await out('Map: computeIfAbsent, LinkedHashMap, setValue, TreeMap-навигация', `Map<String, List<Integer>> groups = new TreeMap<>();
for (int i = 1; i <= 6; i++) groups.computeIfAbsent(i % 2 == 0 ? "чёт" : "нечет", k -> new ArrayList<>()).add(i);
System.out.println(groups);
Map<String, Integer> sc = new LinkedHashMap<>();
sc.put("b", 2); sc.put("a", 1); sc.putIfAbsent("a", 9); sc.put("c", 3);
for (Map.Entry<String, Integer> e : sc.entrySet()) e.setValue(e.getValue() * 10);
System.out.println(sc + " " + sc.getOrDefault("z", -1) + " " + sc.keySet() + " " + sc.values());
TreeMap<Integer, String> tm = new TreeMap<>(Map.of(10, "a", 20, "b", 30, "c"));
System.out.println(tm.floorKey(25) + " " + tm.ceilingEntry(11) + " " + tm.headMap(20) + " " + tm.tailMap(20, true) + " " + tm.firstEntry().getValue() + " " + tm.lastKey() + " " + tm.descendingMap());`,
  ['{нечет=[1, 3, 5], чёт=[2, 4, 6]}', '{b=20, a=10, c=30} -1 [b, a, c] [20, 10, 30]', '20 20=b {10=a} {20=b, 30=c} a 30 {30=c, 20=b, 10=a}']);
  await out('Collections.shuffle с Random(42) — как в Java; reverse, max, frequency, subList, hashCode', `List<Integer> nums = new ArrayList<>(List.of(1, 2, 3, 4, 5, 6, 7, 8));
Collections.shuffle(nums, new Random(42));
System.out.println(nums);
Collections.reverse(nums);
System.out.println(nums + " " + Collections.max(nums) + " " + Collections.frequency(List.of(1, 2, 1), 1) + " " + Collections.nCopies(3, "x"));
System.out.println(nums.subList(1, 3) + " " + List.of(1, 2).equals(Arrays.asList(1, 2)) + " " + List.of(1, 2).hashCode() + " " + Map.of("a", 1).equals(new HashMap<>(Map.of("a", 1))));`,
  ['[3, 7, 4, 2, 5, 1, 8, 6]', '[6, 8, 1, 5, 2, 4, 7, 3] 8 2 [x, x, x]', '[8, 1] true 994 true']);
  await out('Optional и Collectors (groupingBy в TreeMap, toCollection, mapping, summingInt)', `Optional<String> o1 = Optional.of("кот");
System.out.println(o1.map(String::length).orElse(0) + " " + Optional.<String>empty().map(String::length).orElseGet(() -> -1) + " " + o1.filter(s -> s.startsWith("к")).isPresent());
o1.ifPresent(s -> System.out.println("есть " + s));
List<String> ws = List.of("арбуз", "банан", "апельсин", "вишня", "абрикос");
System.out.println(ws.stream().collect(Collectors.groupingBy(w -> w.charAt(0), TreeMap::new, Collectors.toList())));
System.out.println(ws.stream().collect(Collectors.toCollection(TreeSet::new)) + " " + ws.stream().collect(Collectors.summingInt(String::length)) + " " + ws.stream().collect(Collectors.averagingDouble(String::length)));
System.out.println(ws.stream().map(String::length).collect(Collectors.toSet()) + " " + Stream.generate(() -> "ы").limit(3).collect(Collectors.joining()) + " " + IntStream.iterate(1, x -> x < 50, x -> x * 3).boxed().toList());
System.out.println(ws.stream().collect(Collectors.groupingBy(String::length, Collectors.mapping(w -> w.substring(0, 2), Collectors.joining("|")))));`,
  ['3 -1 true', 'есть кот', '{а=[арбуз, апельсин, абрикос], б=[банан], в=[вишня]}', '[абрикос, апельсин, арбуз, банан, вишня] 30 6.0', '[5, 7, 8] ыыы [1, 3, 9, 27]', '{5=ар|ба|ви, 7=аб, 8=ап}']);
  await out('исключения: причина, finally в цикле с continue, Objects', `try { try { throw new IllegalArgumentException("внутри"); } catch (RuntimeException e) { throw new IllegalStateException("снаружи", e); } }
catch (IllegalStateException e) { System.out.println(e.getMessage() + " <- " + e.getCause().getMessage() + " " + (e.getCause() instanceof IllegalArgumentException)); }
int tries = 0;
for (int i = 0; i < 5; i++) { try { if (i % 2 == 0) continue; tries++; } finally { tries += 10; } }
System.out.println("tries " + tries);
try { Objects.requireNonNull(null, "пусто!"); } catch (NullPointerException e) { System.out.println("NPE: " + e.getMessage()); }
System.out.println(Objects.hash(1, "a") + " " + Objects.toString(null, "—") + " " + Objects.isNull(null) + " " + Objects.requireNonNullElse(null, 5));`,
  ['снаружи <- внутри true', 'tries 52', 'NPE: пусто!', '1089 — true 5']);
  await out('long-маски, char в switch, Deque, format %n %%', `long mask = 0L; for (int i = 0; i < 64; i += 8) mask |= 1L << i;
System.out.println(Long.toHexString(mask) + " " + Long.bitCount(mask) + " " + (mask >>> 56) + " " + (int) mask + " " + Long.hashCode(1L << 40));
String vowels = "";
for (char ch : "программа".toCharArray()) switch (ch) { case 'а', 'о', 'у', 'ы', 'э', 'я', 'е', 'ё', 'ю', 'и' -> vowels += ch; default -> {} }
System.out.println(vowels);
Deque<String> dq = new ArrayDeque<>(); dq.offerLast("a"); dq.offerFirst("b"); dq.addLast("c");
System.out.println(dq.pollFirst() + dq.pollLast() + dq.peekFirst() + " " + dq.size());
System.out.print(String.format("100%% готово%n"));
System.out.println("hello".chars().mapToObj(ch -> String.valueOf((char) ch)).collect(Collectors.joining(",")) + " " + "a1b2".replaceAll("[0-9]", "#") + " " + "x,y;z".split("[,;]").length);`,
  ['101010101010101 8 1 16843009 256', 'оаа', 'bca 1', '100% готово', 'h,e,l,l,o a#b# 3']);

  // ═══ Мир «Студии 3D»: код верхнего уровня ═══
  {
    const W = world(`Players.PlayerAdded.Connect(pl -> {
    pl.Humanoid.WalkSpeed = 24;
    pl.Teleport(new Vector3(0, 10, 0));
    System.out.println("скорость " + pl.Humanoid.WalkSpeed + " из " + pl.Humanoid.MaxHealth);
});
Part p = script.Parent;
Part copy = p.Clone();
copy.Name = "Копия";
copy.Parent = workspace;
System.out.println(copy.Name + " " + p.IsA("Part") + " " + (workspace.FindFirstChild("Копия") != null));
p.SetAttribute("hp", 5);
System.out.println(p.GetAttribute("hp"));
Part win = workspace.WaitForChild("Дом").FindFirstChild("Окно");
System.out.println("окно: " + win.Name + " в " + win.Parent.Name);
Game.Mode = "coins";
Camera.Shake(1, 0.3);
gui.text("score", "Очки: 0");
Debris.AddItem(copy, 5);
double dt2 = RunService.Heartbeat.Wait();
System.out.println("дождался кадра " + (dt2 > 0));`);
    await sleep(10);
    W.tick(0.1, 2);
    await sleep(20);
    const P = W.prints();
    ok(JSON.stringify(P) === JSON.stringify(['Копия true true', '5', 'скорость 24.0 из 100.0', 'окно: Окно в Дом', 'дождался кадра true']) && !W.errors().length &&
      W.of('gui').some(m => m.cmd === 'text' && m.text === 'Очки: 0') && W.of('camera').length >= 1, 'мир: Clone, атрибуты, WaitForChild и Heartbeat.Wait() ждут, Game, Camera, gui, Debris, Humanoid', [P, W.errors()]);
  }
  {
    const W = await out('мир: свойства детали, Vector3, FindFirstChild, Color3', `Part coin = script.Parent;
System.out.println(coin.Name + " " + coin.Size.X + " " + coin.Anchored);
Vector3 v = new Vector3(1, 2, 3).add(new Vector3(1, 1, 1));
System.out.println(v.X + " " + v.Magnitude);
Part floor = workspace.FindFirstChild("Пол", true);
System.out.println("пол: " + (floor != null ? floor.Name : "нет"));
coin.Color = Color3.fromRGB(255, 200, 0);
coin.Transparency = 0.25;
coin.Material = Enum.Material.Neon;
System.out.println(coin.Transparency + " " + coin.Material);`, ['Деталь 4.0 true', '2.0 5.385164807134504', 'пол: Пол', '0.25 neon']);
    ok(W.of('set').some(m => m.id === 'a' && (m.k === 'alpha' || m.prop === 'alpha' || JSON.stringify(m).includes('0.25'))), 'мир: Transparency ушла хозяину мира', W.of('set'));
  }
  {
    const W = world(`int touches = 0;
Part coin = script.Parent;
coin.Touched.Connect((hit, player) -> {
    if (player == null) return;
    touches++;
    player.AddStat("Монеты", 1);
    System.out.println("коснулся " + player.Name + " #" + touches);
});
Players.PlayerAdded.Connect(p -> System.out.println("вошёл " + p.Name));
int[] beats = {0};
RunService.Heartbeat.Connect(dt -> beats[0]++);
for (int i = 0; i < 3; i++) { System.out.println("шаг " + i); wait(0.01); }
Thread.sleep(10);
task.delay(0.01, () -> System.out.println("delay, кадров: " + beats[0]));`);
    await sleep(5);
    W.ev('touched', { id: 'a' }); W.ev('touched', { id: 'a' });
    W.tick(0.1, 4);
    await sleep(120);
    const P = W.prints();
    ok(P[0] === 'шаг 0' && P.includes('вошёл Тест') && P.includes('коснулся Тест #2') && P.includes('шаг 2') && P[P.length - 1] === 'delay, кадров: 4' && !W.errors().length,
      'мир: Touched, PlayerAdded, Heartbeat, wait() и Thread.sleep в коде верхнего уровня, task.delay', [P, W.errors()]);
    ok(W.of('player').some(m => m.cmd === 'stat' || JSON.stringify(m).includes('Монеты')), 'мир: AddStat дошёл до хозяина', W.of('player'));
  }
  {
    const W = world(`public class Spinner extends Script {
    public double speed = 90;
    private int frames = 0;
    private final List<String> log = new ArrayList<>();

    @Override
    public void start() {
        System.out.println("start: " + getParent().Name + " скорость " + speed);
        log.add("start");
        wait(0.02);
        System.out.println("после wait в start");
    }

    public void update(double dt) {
        frames++;
        Vector3 r = Parent.Orientation;
        Parent.Orientation = new Vector3(r.X, (r.Y + speed * dt) % 360, r.Z);
        if (frames == 3) System.out.println("кадр 3, угол " + Math.round(Parent.Orientation.Y));
    }

    public void onTouched(Part hit, Player player) {
        if (player == null) return;
        player.Humanoid.TakeDamage(10);
        System.out.println("onTouched " + player.Name + ", здоровье " + player.Humanoid.Health);
    }

    public void onPlayerAdded(Player p) { System.out.println("onPlayerAdded " + p.Name); }
}`);
    await sleep(5);
    W.tick(0.1, 3);
    W.ev('touched', { id: 'a' });
    await sleep(60);
    const P = W.prints();
    ok(P[0] === 'start: Деталь скорость 90.0' && P.includes('onPlayerAdded Тест') && P.includes('кадр 3, угол 27') && P.includes('onTouched Тест, здоровье 90.0') && P.includes('после wait в start') && !W.errors().length,
      'класс extends Script: start() с wait, update(dt), onTouched, onPlayerAdded', [P, W.errors()]);
  }
  {
    const W = world(`Part door = script.Parent;
Vector3 closed = door.Position;
boolean open = false;
door.Prompt("Открыть дверь").Triggered.Connect(player -> {
    open = !open;
    Vector3 to = open ? closed.add(new Vector3(0, door.Size.Y, 0)) : closed;
    TweenService.Create(door, new TweenInfo(0.6), Map.of("Position", to)).Play();
    System.out.println("дверь " + (open ? "открыта" : "закрыта"));
});`);
    await sleep(5);
    W.ev('prompt', { id: 'a' });
    await sleep(5);
    W.ev('prompt', { id: 'a' });
    await sleep(5);
    const tw = W.of('tween');
    ok(W.of('prompt').some(m => m.id === 'a' && m.text === 'Открыть дверь') && tw.length === 2 && tw[0].goals && tw[0].goals.pos && tw[0].goals.pos.join() === '0,2,0' && tw[1].goals.pos.join() === '0,1,0' &&
      JSON.stringify(W.prints()) === '["дверь открыта","дверь закрыта"]' && !W.errors().length, 'мир: Prompt + TweenService с Map.of, поле верхнего уровня меняется в лямбде', [W.prints(), tw, W.errors()]);
  }
  {
    const W = world(`Part floor = workspace.FindFirstChild("Пол", true);
script.Parent.Prompt("Нажать").Triggered.Connect(player -> {
    floor.CanCollide = false;
    System.out.println("пол исчез");
    wait(0.03);
    floor.CanCollide = true;
    System.out.println("пол вернулся " + floor.CanCollide);
});
script.Parent.Clicked.Connect(player -> System.out.println("клик " + player.Name));`);
    await sleep(5);
    W.ev('prompt', { id: 'a' }); W.ev('clicked', { id: 'a' });
    await sleep(80);
    ok(JSON.stringify(W.prints()) === '["пол исчез","клик Тест","пол вернулся true"]' && !W.errors().length, 'мир: wait() внутри обработчика события не держит другие события', [W.prints(), W.errors()]);
  }
  await out('мир: Instance.create, GetChildren, Players.GetPlayers, record в коде верхнего уровня', `record Entry(String name, int coins) {}
Players.PlayerAdded.Connect(p -> p.SetStat("Монеты", 7));
Part base = script.Parent;
for (int i = 0; i < 3; i++) {
    Part block = Instance.create("Part", workspace);
    block.Size = new Vector3(4, 1, 4);
    block.Position = base.Position.add(new Vector3(0, i, i * 4));
    block.Material = "grass";
}
System.out.println("в мире: " + workspace.GetChildren().size());
wait(0.01);   // PlayerAdded приходит после запуска скриптов
List<Entry> board = new ArrayList<>();
for (Player p : Players.GetPlayers()) board.add(new Entry(p.Name, (int) p.GetStat("Монеты")));
System.out.println(board);`, ['в мире: 6', '[Entry[name=Тест, coins=7]]'], { wait: 40 });
  await out('мир: глобальные print/warn/time/random и gui/sound', `print("привет", 1, 2.5);
double t = time();
int r = random(1, 6);
System.out.println((t >= 0) + " " + (r >= 1 && r <= 6));
gui.message("Старт!", 2);
sound.play("coin");`, ['привет 1 2.5', 'true true']);

  // ═══ Несколько скриптов: общие классы ═══
  {
    const W = world([`System.out.println(Util.twice(21) + " " + new Util.Pair("a", 1));`, `class Util { static int twice(int x) { return x * 2; } record Pair(String k, int v) {} }`]);
    await sleep(10);
    ok(JSON.stringify(W.prints()) === '["42 Pair[k=a, v=1]"]' && !W.errors().length, 'класс из другого скрипта (объявлен ниже) — виден', [W.prints(), W.errors()]);
  }

  // ═══ Ошибки перевода: строка Java и понятный текст ═══
  cerr('несовместимые типы', `public class Door extends Script {
    void toggle() {
        int x = "строка";
    }
}`, 3, /Несовместимые типы: String нельзя превратить в int/);
  cerr('потеря точности double → int', `double d = 2.5;\nint i = d;`, 2, /потеря точности/);
  cerr('неизвестное имя', `int a = 1;\nSystem.out.println(b);`, 2, /Имя «b» не найдено/);
  cerr('нет точки с запятой', `int a = 1\nint b = 2;`, 1, /;/);
  cerr('synchronized — понятная ошибка', `class A { synchronized void f() {} }`, 1, /synchronized/);
  cerr('new Thread — потоков нет', `Thread t = new Thread(() -> {});\nt.start();`, 1, /Пото|Thread/);
  cerr('java.io — файлов нет', `import java.io.File;\nint a = 1;`, 1, /файлов/);
  cerr('java.net — сети нет', `import java.net.URL;\nint a = 1;`, 1, /сети/);
  cerr('рефлексия — нет', `Class<?> c = Class.forName("x");`, 1, /рефлекс|forName/i);
  cerr('Scanner — ввода нет', `Scanner sc = new Scanner(System.in);`, 1, /ввод|Scanner/);
  cerr('лямбда меняет локальную переменную — как в Java', `void f() { int n = 0; Runnable r = () -> n++; }`, 1, /effectively final/);
  cerr('wait() внутри toString — нельзя', `class A { public String toString() { wait(1); return "a"; } }\nSystem.out.println(new A());`, 1, /ждать/i);
  cerr('Script — только в «Студии 3D», не в моде', `class X extends Script {}`, 1, /только в «Студии 3D»/, 'mod');
  cerr('типографские кавычки — подсказка', `System.out.println(“привет”);`, 1, /авычк/);
  cerr('метод не найден — подсказка', `String s = "a";\nSystem.out.println(s.lenght());`, 2, /length/);

  // ═══ Ошибки во время игры: строка Java ═══
  await rerr('NullPointerException — строка Java', `String s = null;
System.out.println("до");
System.out.println(s.length());`, 3, /NullPointerException/);
  await rerr('ArithmeticException в обработчике события — строка метода', `int hits = 0;
int div(int a, int b) {
    return a / b;
}
script.Parent.Touched.Connect((hit, player) -> {
    hits++;
    System.out.println(div(10, hits - 1));
});`, 3, /ArithmeticException/, { act: W => W.ev('touched', { id: 'a' }) });
  await rerr('ArrayIndexOutOfBounds — строка и индекс', `int[] a = new int[2];
a[1] = 5;
a[a[1]] = 1;`, 3, /ArrayIndexOutOfBoundsException.*5/);
  await rerr('ClassCastException', `Object o = "s";
Integer i = (Integer) o;`, 2, /ClassCastException/);
  await rerr('своё исключение без catch — имя и текст', `class Boom extends RuntimeException { Boom(String m) { super(m); } }
void go() { throw new Boom("бах"); }
go();`, 2, /Boom: бах/);
  await rerr('бесконечная рекурсия — StackOverflowError', `int f(int n) { return f(n + 1) + 1; }
System.out.println(f(0));`, 1, /StackOverflowError/);
  await rerr('ошибка в update() класса — строка', `public class S extends Script {
    int n = 0;
    public void update(double dt) {
        n++;
        if (n == 2) throw new IllegalStateException("кадр 2");
    }
}`, 5, /IllegalStateException: кадр 2/, { act: W => W.tick(0.1, 3) });

  // ═══ Быстродействие: «без лагов» ═══
  {
    const t0 = Date.now();
    const W = world(`long sum = 0;
for (int i = 0; i < 3_000_000; i++) sum += i % 7;
int[] a = new int[100000];
for (int i = 0; i < a.length; i++) a[i] = (i * 31) % 1000;
Arrays.sort(a);
Map<Integer, Integer> m = new HashMap<>();
for (int i = 0; i < 100000; i++) m.merge(i % 1000, 1, Integer::sum);
System.out.println(sum + " " + a[99999] + " " + m.size());`);
    await sleep(5);
    const dt = Date.now() - t0;
    ok(JSON.stringify(W.prints()) === '["8999994 999 1000"]' && dt < 1500, 'быстродействие: 3 млн итераций + сортировка 100 000 + HashMap — ' + dt + ' мс', [W.prints(), W.errors(), dt]);
  }

  // ═══ Примеры из «📚 Примеры…» ═══
  for (const [title, code] of L.examples) {
    let e = null;
    try { compile(code); } catch (x) { e = x; }
    ok(!e, 'пример переводится: ' + title, e && e.line + ': ' + e.message);
    const W = world(code, { objs: [part('a', 'Деталь'), part('b', 'Пол', { pos: [0, 0, 0] })] });
    await sleep(2);
    W.ev('touched', { id: 'a' }); W.ev('prompt', { id: 'a' }); W.ev('clicked', { id: 'a' }); W.tick(0.1, 3);
    await sleep(5);
    ok(!W.errors().length, 'пример работает: ' + title, W.errors());
  }

  // ═══ Библиотека: всё, что знает переводчик, есть в песочнице ═══
  {
    const W = world('System.out.println(1);');
    await sleep(2);
    const J = W.ctx.D37Lang.java, RT = J.rt(), lib = J.lib('studio');
    const A = Object.assign(Object.create(RT.A), { System: { out: 1, err: 1, arraycopy: 1, identityHashCode: 1 } });   // System — у каждого скрипта свой ($A скрипта)
    const IMPL = { List: ['ArrayList', 'LinkedList', 'Stack'], Collection: ['ArrayList', 'LinkedList', 'HashSet', 'LinkedHashSet', 'TreeSet', 'ArrayDeque', 'PriorityQueue'],
      Iterable: ['ArrayList', 'HashSet', 'ArrayDeque'], Set: ['HashSet', 'LinkedHashSet', 'TreeSet'], Map: ['HashMap', 'LinkedHashMap', 'TreeMap'], Deque: ['ArrayDeque', 'LinkedList'],
      Queue: ['ArrayDeque', 'LinkedList', 'PriorityQueue'] };
    const miss = [];
    for (const [ifc, impls] of Object.entries(IMPL)) {
      const e = lib.get(ifc); if (!e) { miss.push('нет ' + ifc); continue; }
      for (const im of impls) { const C = RT.A[im]; if (!C) { miss.push('нет класса ' + im); continue; } for (const sigs of e.m.values()) for (const sg of sigs) if (!(sg.js in C.prototype)) miss.push(im + '#' + sg.js); }
    }
    ok(!miss.length, 'методы List/Set/Map/Deque/Queue есть у каждой реализации', miss);
    const argOf = t => t === 'int' || t === 'short' || t === 'byte' ? '1' : t === 'long' ? '1L' : t === 'double' ? '1.0' : t === 'float' ? '1f' : t === 'char' ? "'a'" : t === 'boolean' ? 'true' : t === 'String' ? '"a"' : '(' + t.replace(/<.*>/, '').replace(/^[A-Z][0-9]?$/, 'Object') + ') null';
    const bad = [];
    let n = 0;
    for (const [name, e] of lib) {
      if (e.world) continue;
      for (const [m, sigs] of e.s) for (const sg of sigs) {
        if (sg.va) continue;
        const call = name + '.' + m + '(' + sg.ps.map(argOf).join(', ') + ')';
        let r;
        try { r = J.compile(sg.ret === 'void' ? call + ';' : 'var x = ' + call + ';'); } catch (x) { continue; }
        n++;
        for (const mm of r.js.matchAll(/\$A\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
          const o = A[mm[1]];
          if (o === undefined) bad.push(name + '.' + m + ' → $A.' + mm[1]);
          else if (mm[2] && !(mm[2] in Object(o))) bad.push(name + '.' + m + ' → $A.' + mm[1] + '.' + mm[2]);
        }
      }
    }
    ok(!bad.length && n > 300, 'каждый static-метод библиотеки (' + n + ') ссылается на то, что есть в песочнице', bad);
  }

  await sleep(30);
  console.log(`\n${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);   // в примерах бесконечные циклы с wait() и таймеры — ждать их не нужно
}
main().catch(e => { console.log('ТЕСТ УПАЛ', e && e.stack || e); process.exit(1); });

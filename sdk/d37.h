/* ═══════════════════════════════════════
   d37.h — SDK «Студии 3D» сайта dan4ik37 для C и C++: скрипт — модуль WebAssembly
   ═══════════════════════════════════════
   На сайте: у скрипта язык «C++ (WebAssembly)» → «⚙️ Собрать» (этот файл подключается сам, писать #include не нужно).
   У себя (wasi-sdk): clang++ --target=wasm32-wasip1 -mexec-model=reactor -std=c++20 -O2 -fno-exceptions -include d37.h
     мой.cpp -o мой.wasm → «📦 Загрузить .wasm». Без libc (только C-функции и обработчики-функции, без лямбд с захватом):
     clang --target=wasm32 -O2 -nostdlib -Wl,--no-entry мой.c -o мой.wasm
   Скрипт пишет функцию start() — её зовут один раз при «▶ Играть». Пример (C++):
     void start() {
       d37::Part coin = d37::script_parent();
       coin.on_touched([coin](d37::Player p) { if (!p) return; p.add_stat("Монеты", 1); coin.destroy(); });
     }

   ── ABI, версия 1: модуль импорта "d37" (меняется только добавлением новых функций) ──
   Номер (handle) — i32: объект, игрок, плавное изменение, подписка или таймер; 0 — нет (там, где ждут родителя, 0 — Workspace).
   Строки — (адрес, длина) в байтах UTF-8 в памяти модуля (экспорт memory); длиннее 4096 байт — обрезаются; адрес за памятью —
   ошибка. Строки наружу: (буфер, ёмкость) → сколько байт записано (по границе символа). Обработчик — число cb: сайт зовёт
   экспорт d37_event(cb, arg), что значит cb — решает SDK (тут: номер функции в таблице × 8 + вид, см. d37_export_event).
   Экспорты модуля: d37_start() — обязательно; d37_event(i32 cb, i32 arg) — если есть обработчики; d37_update(f64 dt) — если
   включён want_update(1); memory; _initialize (WASI) или __wasm_call_ctors — их сайт зовёт до d37_start.
   За один вызов модуля — не больше 200 000 обращений к сайту и 5000 команд миру (иначе ошибка); упал (trap) — ошибка во
   «Вывод», модуль работает дальше; 30 ошибок или память больше 256 МБ — скрипт остановлен.
   Вывод:      print(s,n) · warn(s,n) · error(s,n,строка) — красным, строка 0 = неизвестна
   Объекты:    script()→h (где лежит скрипт, 0 — в Workspace) · find(s,n)→h (по имени во всём мире) · find_in(родитель,s,n,вглубь)→h
               parent(h)→h · children(h)→число · child(h,i)→h · exists(h)→0/1 · create(вид,родитель)→h · clone(h)→h · destroy(h)
               set_parent(h,родитель) · get(h,свойство)→f64 · set(h,свойство,f64) · set3(h,что,x,y,z)
               get_str(h,какое,буф,ёмк)→байт · set_str(h,какое,s,n)
   Плавно:     tween(h,что,x,y,z,время,сглаживание,туда-обратно,повторы(−1 — всегда),задержка)→t · tween_cancel(t) · on_tween_done(t,cb)→c
   События:    on_touched(h,cb)→c · on_touch_ended(h,cb)→c · on_clicked(h,cb)→c · prompt(h,s,n,удержание,cb)→c (cb 0 — только текст)
               on_player_added(cb)→c · on_player_removing(cb)→c · on_died(cb)→c · off(c) · want_update(вкл) · event_target()→h
               (arg у событий объектов и игроков — номер игрока, 0 — коснулся не игрок)
   Таймеры:    delay(сек,cb)→t (arg = t) · every(сек,cb)→t · cancel(t) · random()→[0,1) · random_int(a,b) · time()→сек с начала
   Игроки:     players()→число · player(i)→p · player_name(p,буф,ёмк)→байт · pget(p,какое)→f64 · pset(p,какое,f64)
               stat_get(p,s,n)→f64 · stat_set(p,s,n,v) · stat_add(p,s,n,d) · teleport(p,x,y,z) · message(p,s,n,сек) · kill(p) · respawn(p)
   Экран/звук: gui_message(s,n,сек) · gui_text(ключ,n,s,n) · gui_clear(ключ,n) · sound(имя,n,h — где, 0 — рядом с игроком)
*/
#ifndef D37_H
#define D37_H 1
#define D37_ABI 1

#ifndef D37_HOSTED
#  if defined(__wasi__) && defined(__cplusplus)
#    define D37_HOSTED 1   /* сборка сайта: есть libc++ — std::string, лямбды с захватом */
#  else
#    define D37_HOSTED 0
#  endif
#endif
#if D37_HOSTED
#  include <cstdio>
#  include <functional>
#  include <string>
#  include <string_view>
#  include <type_traits>
#  include <utility>
#  include <vector>
#endif

/* ── Номера свойств ── */
enum {
  D37_POS_X = 0, D37_POS_Y = 1, D37_POS_Z = 2, D37_SIZE_X = 3, D37_SIZE_Y = 4, D37_SIZE_Z = 5,
  D37_ROT_X = 6, D37_ROT_Y = 7, D37_ROT_Z = 8,                     /* поворот — градусы */
  D37_TRANSPARENCY = 9, D37_CAN_COLLIDE = 10, D37_ANCHORED = 11,     /* 0…1, 0/1, 0/1 */
  D37_COLOR = 12,                                                   /* 0xRRGGBB */
  D37_CAST_SHADOW = 13, D37_RANGE = 14, D37_BRIGHTNESS = 15          /* тень 0/1; свет: дальность, яркость */
};
enum { D37_POSITION = 0, D37_SIZE = 1, D37_ROTATION = 2, D37_RGB = 3, D37_ALPHA = 4 };   /* set3 / tween: «что» (ALPHA — только tween, x) */
enum { D37_NAME = 0, D37_MATERIAL = 1, D37_SHAPE = 2, D37_TEXT = 3, D37_CLASS = 4 };     /* get_str / set_str */
enum { D37_NEW_PART = 0, D37_NEW_WEDGE = 1, D37_NEW_LIGHT = 2, D37_NEW_MODEL = 3, D37_NEW_SPAWN = 4 };   /* create */
enum { D37_LINEAR = 0, D37_QUAD = 1, D37_SINE = 2, D37_BACK = 3, D37_BOUNCE = 4, D37_ELASTIC = 5 };     /* сглаживание */
enum { D37_HEALTH = 0, D37_MAX_HEALTH = 1, D37_WALK_SPEED = 2, D37_JUMP_POWER = 3, D37_PLAYER_X = 4, D37_PLAYER_Y = 5, D37_PLAYER_Z = 6 };

#ifdef __cplusplus
extern "C" {
#endif
#define D37_IMPORT(n) __attribute__((import_module("d37"), import_name(#n)))
#define D37_EXPORT(n) __attribute__((export_name(#n)))
/* ── Функции сайта (сырые: строки — адрес и длина) ── */
D37_IMPORT(print) void d37_print(const char *s, int n);
D37_IMPORT(warn) void d37_warn(const char *s, int n);
D37_IMPORT(error) void d37_error(const char *s, int n, int line);
D37_IMPORT(script) int d37_script(void);
D37_IMPORT(find) int d37_find(const char *name, int n);
D37_IMPORT(find_in) int d37_find_in(int parent, const char *name, int n, int deep);
D37_IMPORT(parent) int d37_parent(int h);
D37_IMPORT(children) int d37_children(int h);
D37_IMPORT(child) int d37_child(int h, int i);
D37_IMPORT(exists) int d37_exists(int h);
D37_IMPORT(get) double d37_get(int h, int prop);
D37_IMPORT(set) void d37_set(int h, int prop, double v);
D37_IMPORT(set3) void d37_set3(int h, int what, double x, double y, double z);
D37_IMPORT(get_str) int d37_get_str(int h, int which, char *buf, int cap);
D37_IMPORT(set_str) void d37_set_str(int h, int which, const char *s, int n);
D37_IMPORT(create) int d37_create(int kind, int parent);
D37_IMPORT(clone) int d37_clone(int h);
D37_IMPORT(destroy) void d37_destroy(int h);
D37_IMPORT(set_parent) void d37_set_parent(int h, int parent);
D37_IMPORT(tween) int d37_tween(int h, int what, double x, double y, double z, double time, int ease, int reverses, int repeat, double delay);
D37_IMPORT(tween_cancel) void d37_tween_cancel(int t);
D37_IMPORT(on_tween_done) int d37_on_tween_done(int t, int cb);
D37_IMPORT(on_touched) int d37_on_touched(int h, int cb);
D37_IMPORT(on_touch_ended) int d37_on_touch_ended(int h, int cb);
D37_IMPORT(on_clicked) int d37_on_clicked(int h, int cb);
D37_IMPORT(prompt) int d37_prompt(int h, const char *text, int n, double hold, int cb);
D37_IMPORT(on_player_added) int d37_on_player_added(int cb);
D37_IMPORT(on_player_removing) int d37_on_player_removing(int cb);
D37_IMPORT(on_died) int d37_on_died(int cb);
D37_IMPORT(off) void d37_off(int c);
D37_IMPORT(want_update) void d37_want_update(int on);
D37_IMPORT(event_target) int d37_event_target(void);
D37_IMPORT(delay) int d37_delay(double sec, int cb);
D37_IMPORT(every) int d37_every(double sec, int cb);
D37_IMPORT(cancel) void d37_cancel(int t);
D37_IMPORT(random) double d37_random(void);
D37_IMPORT(random_int) int d37_random_int(int a, int b);
D37_IMPORT(time) double d37_time(void);
D37_IMPORT(players) int d37_players(void);
D37_IMPORT(player) int d37_player(int i);
D37_IMPORT(player_name) int d37_player_name(int p, char *buf, int cap);
D37_IMPORT(pget) double d37_pget(int p, int which);
D37_IMPORT(pset) void d37_pset(int p, int which, double v);
D37_IMPORT(stat_get) double d37_stat_get(int p, const char *k, int kn);
D37_IMPORT(stat_set) void d37_stat_set(int p, const char *k, int kn, double v);
D37_IMPORT(stat_add) void d37_stat_add(int p, const char *k, int kn, double d);
D37_IMPORT(teleport) void d37_teleport(int p, double x, double y, double z);
D37_IMPORT(message) void d37_message(int p, const char *s, int n, double sec);
D37_IMPORT(kill) void d37_kill(int p);
D37_IMPORT(respawn) void d37_respawn(int p);
D37_IMPORT(gui_message) void d37_gui_message(const char *s, int n, double sec);
D37_IMPORT(gui_text) void d37_gui_text(const char *key, int kn, const char *s, int n);
D37_IMPORT(gui_clear) void d37_gui_clear(const char *key, int kn);
D37_IMPORT(sound) void d37_sound(const char *name, int n, int at);

/* ── Помощники для C (z — строка с нулём в конце) ── */
/* Обработчики в C: void f(int arg) → D37_CB(f); void f(void) → D37_CB0(f). Пример: d37_on_touched(h, D37_CB(on_touch)); */
#define D37_CB(f) ((int)(((unsigned)(__UINTPTR_TYPE__)(f) << 3) | 0u))
#define D37_CB0(f) ((int)(((unsigned)(__UINTPTR_TYPE__)(f) << 3) | 1u))
__attribute__((no_builtin)) static inline int d37_len(const char *s) { int n = 0; if (s) while (s[n]) n++; return n; }
static inline void d37_printz(const char *s) { d37_print(s, d37_len(s)); }
static inline void d37_warnz(const char *s) { d37_warn(s, d37_len(s)); }
static inline int d37_findz(const char *name) { return d37_find(name, d37_len(name)); }
static inline int d37_promptz(int h, const char *text, double hold, int cb) { return d37_prompt(h, text, d37_len(text), hold, cb); }
static inline void d37_stat_addz(int p, const char *k, double d) { d37_stat_add(p, k, d37_len(k), d); }
static inline void d37_stat_setz(int p, const char *k, double v) { d37_stat_set(p, k, d37_len(k), v); }
static inline double d37_stat_getz(int p, const char *k) { return d37_stat_get(p, k, d37_len(k)); }
static inline void d37_soundz(const char *name, int at) { d37_sound(name, d37_len(name), at); }
static inline void d37_gui_messagez(const char *s, double sec) { d37_gui_message(s, d37_len(s), sec); }
static inline void d37_gui_textz(const char *key, const char *s) { d37_gui_text(key, d37_len(key), s, d37_len(s)); }
static inline void d37_set_strz(int h, int which, const char *s) { d37_set_str(h, which, s, d37_len(s)); }
/* число → текст без libc: 5 → "5", 2.5 → "2.5", 1/3 → "0.333"; возвращает длину */
__attribute__((no_builtin)) static inline int d37_fmt(char *buf, int cap, double v) {
  char t[40]; int n = 0, k = 0, i;
  unsigned long long ip; unsigned f;
  if (cap <= 0) return 0;
  if (v != v) { t[n++] = 'N'; t[n++] = 'a'; t[n++] = 'N'; }
  else {
    if (v < 0) { t[n++] = '-'; v = -v; }
    if (v >= 1.8e19) { t[n++] = 'i'; t[n++] = 'n'; t[n++] = 'f'; }
    else {
      char d[24];
      ip = (unsigned long long)v;
      f = (unsigned)((v - (double)ip) * 1000.0 + 0.5);
      if (f >= 1000) { ip++; f -= 1000; }
      do { d[k++] = (char)('0' + (int)(ip % 10)); ip /= 10; } while (ip && k < 22);
      while (k) t[n++] = d[--k];
      if (f) { t[n++] = '.'; t[n++] = (char)('0' + f / 100); t[n++] = (char)('0' + f / 10 % 10); t[n++] = (char)('0' + f % 10); while (t[n - 1] == '0') n--; }
    }
  }
  if (n > cap - 1) n = cap - 1;
  for (i = 0; i < n; i++) buf[i] = t[i];
  buf[n] = 0;
  return n;
}
/* обновление каждый кадр для C: d37_on_update(f), где void f(double dt) */
typedef void (*d37_update_fn)(double);
__attribute__((weak)) d37_update_fn d37_upd_fn_ptr = 0;
static inline void d37_on_update(d37_update_fn f) { d37_upd_fn_ptr = f; d37_want_update(1); }
#ifdef __cplusplus
}
#endif

/* ═══ C++: d37::Part, d37::Player, лямбды-обработчики ═══ */
#ifdef __cplusplus
namespace d37 {

/* строка для любого вызова: "текст", char*, а в сборке сайта — ещё std::string и std::string_view */
struct Str {
  const char *p; int n;
  Str(const char *s) : p(s ? s : ""), n(d37_len(s)) {}
  Str(const char *s, int len) : p(s), n(len) {}
#if D37_HOSTED
  Str(const std::string &s) : p(s.data()), n((int)s.size()) {}
  Str(std::string_view s) : p(s.data()), n((int)s.size()) {}
#endif
};
/* текст без libc: print(Text() << "Монеты: " << 5); */
struct Text {
  char b[512]; int n;
  Text() : n(0) { b[0] = 0; }
  __attribute__((no_builtin)) Text &operator<<(Str s) { for (int i = 0; i < s.n && n < 511; i++) b[n++] = s.p[i]; b[n] = 0; return *this; }
  Text &operator<<(double v) { n += d37_fmt(b + n, 512 - n, v); return *this; }
  Text &operator<<(int v) { return *this << (double)v; }
  Text &operator<<(long long v) { return *this << (double)v; }
  Text &operator<<(unsigned v) { return *this << (double)v; }
  Text &operator<<(char c) { if (n < 511) { b[n++] = c; b[n] = 0; } return *this; }
  const char *c_str() const { return b; }
  int size() const { return n; }
  operator Str() const { return Str(b, n); }
  __attribute__((no_builtin)) bool operator==(Str s) const { if (s.n != n) return false; for (int i = 0; i < n; i++) if (b[i] != s.p[i]) return false; return true; }
  bool operator!=(Str s) const { return !(*this == s); }
#if D37_HOSTED
  std::string str() const { return std::string(b, (size_t)n); }
  operator std::string() const { return str(); }
#endif
};
inline Text num(double v) { Text t; t << v; return t; }

struct Vec3 {
  double x, y, z;
  constexpr Vec3() : x(0), y(0), z(0) {}
  constexpr Vec3(double X, double Y, double Z) : x(X), y(Y), z(Z) {}
  constexpr Vec3 operator+(Vec3 o) const { return Vec3(x + o.x, y + o.y, z + o.z); }
  constexpr Vec3 operator-(Vec3 o) const { return Vec3(x - o.x, y - o.y, z - o.z); }
  constexpr Vec3 operator*(double k) const { return Vec3(x * k, y * k, z * k); }
  constexpr Vec3 operator-() const { return Vec3(-x, -y, -z); }
  Vec3 &operator+=(Vec3 o) { x += o.x; y += o.y; z += o.z; return *this; }
  Vec3 &operator-=(Vec3 o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
  double length() const { return __builtin_sqrt(x * x + y * y + z * z); }
};

enum class Ease { Linear = 0, Quad = 1, Sine = 2, Back = 3, Bounce = 4, Elastic = 5 };
/* как плавно: TweenInfo(0.6) или TweenInfo(3).ease(Ease::Sine).reverses().forever() */
struct TweenInfo {
  double time_, delay_; Ease ease_; bool reverses_; int repeat_;
  TweenInfo(double t = 1) : time_(t), delay_(0), ease_(Ease::Quad), reverses_(false), repeat_(0) {}
  TweenInfo &ease(Ease e) { ease_ = e; return *this; }
  TweenInfo &reverses(bool r = true) { reverses_ = r; return *this; }
  TweenInfo &repeat(int n) { repeat_ = n; return *this; }
  TweenInfo &forever() { repeat_ = -1; return *this; }
  TweenInfo &delay(double s) { delay_ = s; return *this; }
};

struct Player;
struct Part;
/* подписка на событие: c.off() — отписаться */
struct Conn {
  int host, cb;
  constexpr Conn() : host(0), cb(0) {}
  constexpr Conn(int h, int c) : host(h), cb(c) {}
  void off();
};
/* таймер: t.cancel() — отменить */
struct Timer {
  int host, cb;
  constexpr Timer() : host(0), cb(0) {}
  constexpr Timer(int h, int c) : host(h), cb(c) {}
  void cancel();
};
struct Tween {
  int host;
  constexpr Tween() : host(0) {}
  explicit constexpr Tween(int h) : host(h) {}
  void cancel() const { d37_tween_cancel(host); }
#if D37_HOSTED
  template <class F> Conn on_done(F f) const;
#else
  Conn on_done(void (*f)()) const;
#endif
};

struct Player {
  int h;
  constexpr Player() : h(0) {}
  explicit constexpr Player(int handle) : h(handle) {}
  explicit operator bool() const { return h != 0; }
  bool operator==(Player o) const { return h == o.h; }
  bool operator!=(Player o) const { return h != o.h; }
  Text name() const { Text t; t.n = d37_player_name(h, t.b, 511); t.b[t.n] = 0; return t; }
  double health() const { return d37_pget(h, D37_HEALTH); }
  void set_health(double v) const { d37_pset(h, D37_HEALTH, v); }
  double max_health() const { return d37_pget(h, D37_MAX_HEALTH); }
  void set_max_health(double v) const { d37_pset(h, D37_MAX_HEALTH, v); }
  void damage(double n) const { set_health(health() - (n > 0 ? n : 0)); }
  double walk_speed() const { return d37_pget(h, D37_WALK_SPEED); }       /* обычно 16 */
  void set_walk_speed(double v) const { d37_pset(h, D37_WALK_SPEED, v); }
  double jump_power() const { return d37_pget(h, D37_JUMP_POWER); }       /* обычно 50 */
  void set_jump_power(double v) const { d37_pset(h, D37_JUMP_POWER, v); }
  Vec3 position() const { return Vec3(d37_pget(h, D37_PLAYER_X), d37_pget(h, D37_PLAYER_Y), d37_pget(h, D37_PLAYER_Z)); }
  void teleport(Vec3 v) const { d37_teleport(h, v.x, v.y, v.z); }
  void teleport(double x, double y, double z) const { d37_teleport(h, x, y, z); }
  double stat(Str k) const { return d37_stat_get(h, k.p, k.n); }
  void set_stat(Str k, double v) const { d37_stat_set(h, k.p, k.n, v); }
  void add_stat(Str k, double d) const { d37_stat_add(h, k.p, k.n, d); }
  void message(Str s, double sec = 3) const { d37_message(h, s.p, s.n, sec); }
  void kill() const { d37_kill(h); }
  void respawn() const { d37_respawn(h); }
};

namespace detail {
enum { K_INT = 0, K_VOID = 1, K_PLAYER = 2, K_BOX = 4 };
inline int enc(unsigned v, unsigned kind) { return (int)((v << 3) | kind); }
template <class T> inline unsigned fnum(T f) { return (unsigned)(__UINTPTR_TYPE__)f; }
#if D37_HOSTED
/* лямбды с захватом: хранятся тут, сайту уходит номер ячейки; host — номер подписки/таймера у сайта (уникален) */
struct Slot { std::function<void(int)> fn; int host = 0; bool once = false, used = false; };
inline std::vector<Slot> &slots() { static std::vector<Slot> v; return v; }
inline std::vector<unsigned> &spare() { static std::vector<unsigned> v; return v; }
inline std::vector<std::function<void(double)>> &updates() { static std::vector<std::function<void(double)>> v; return v; }
inline unsigned keep(std::function<void(int)> fn, bool once) {
  std::vector<Slot> &S = slots(); unsigned i;
  if (!spare().empty()) { i = spare().back(); spare().pop_back(); } else { i = (unsigned)S.size(); S.emplace_back(); }
  S[i].fn = std::move(fn); S[i].host = 0; S[i].once = once; S[i].used = true;
  return i;
}
inline int bind(unsigned i, int host) { slots()[i].host = host; return host; }
inline void release(unsigned i) { Slot &s = slots()[i]; s.fn = nullptr; s.host = 0; s.used = false; spare().push_back(i); }
inline void drop(int cb, int host) {
  unsigned u = (unsigned)cb; if ((u & 7) != K_BOX) return;
  unsigned i = u >> 3; std::vector<Slot> &S = slots();
  if (i < S.size() && S[i].used && S[i].host == host) release(i);
}
inline void dispatch(unsigned i, int arg) {
  std::vector<Slot> &S = slots();
  if (i >= S.size() || !S[i].used || !S[i].fn) return;
  int host = S[i].host; bool once = S[i].once;
  std::function<void(int)> fn = std::move(S[i].fn);
  S[i].fn = nullptr;
  if (once) release(i);             /* освобождаем до вызова: обработчик может завести новый таймер */
  fn(arg);
  if (!once) { std::vector<Slot> &S2 = slots(); if (i < S2.size() && S2[i].used && S2[i].host == host && !S2[i].fn) S2[i].fn = std::move(fn); }
}
template <class F> inline unsigned player_box(F f, bool once) {
  return keep([f](int a) mutable { if constexpr (std::is_invocable_v<F &, Player>) f(Player(a)); else f(); }, once);
}
template <class F> inline unsigned void_box(F f, bool once) { return keep([f](int) mutable { f(); }, once); }
#else
inline void drop(int, int) {}
#endif
}  // namespace detail

inline void Conn::off() { d37_off(host); detail::drop(cb, host); host = 0; }
inline void Timer::cancel() { d37_cancel(host); detail::drop(cb, host); host = 0; }

struct Part {
  int h;   /* 0 — нет детали (или Workspace) */
  constexpr Part() : h(0) {}
  explicit constexpr Part(int handle) : h(handle) {}
  explicit operator bool() const { return h != 0 && d37_exists(h); }
  bool exists() const { return h != 0 && d37_exists(h); }
  bool operator==(Part o) const { return h == o.h; }
  bool operator!=(Part o) const { return h != o.h; }
  /* положение, размер, поворот (градусы), цвет (0…1) */
  Vec3 position() const { return Vec3(d37_get(h, D37_POS_X), d37_get(h, D37_POS_Y), d37_get(h, D37_POS_Z)); }
  void set_position(Vec3 v) const { d37_set3(h, D37_POSITION, v.x, v.y, v.z); }
  void set_position(double x, double y, double z) const { d37_set3(h, D37_POSITION, x, y, z); }
  Vec3 size() const { return Vec3(d37_get(h, D37_SIZE_X), d37_get(h, D37_SIZE_Y), d37_get(h, D37_SIZE_Z)); }
  void set_size(Vec3 v) const { d37_set3(h, D37_SIZE, v.x, v.y, v.z); }
  void set_size(double x, double y, double z) const { d37_set3(h, D37_SIZE, x, y, z); }
  Vec3 rotation() const { return Vec3(d37_get(h, D37_ROT_X), d37_get(h, D37_ROT_Y), d37_get(h, D37_ROT_Z)); }
  void set_rotation(Vec3 v) const { d37_set3(h, D37_ROTATION, v.x, v.y, v.z); }
  void set_rotation(double x, double y, double z) const { d37_set3(h, D37_ROTATION, x, y, z); }
  Vec3 color() const { int c = (int)d37_get(h, D37_COLOR); return Vec3((c >> 16 & 255) / 255.0, (c >> 8 & 255) / 255.0, (c & 255) / 255.0); }
  void set_color(double r, double g, double b) const { d37_set3(h, D37_RGB, r, g, b); }
  void set_color(int hex) const { d37_set(h, D37_COLOR, (double)hex); }   /* 0xff0000 — красный */
  double transparency() const { return d37_get(h, D37_TRANSPARENCY); }
  void set_transparency(double v) const { d37_set(h, D37_TRANSPARENCY, v); }
  bool can_collide() const { return d37_get(h, D37_CAN_COLLIDE) != 0; }
  void set_can_collide(bool v) const { d37_set(h, D37_CAN_COLLIDE, v ? 1 : 0); }
  bool anchored() const { return d37_get(h, D37_ANCHORED) != 0; }
  void set_anchored(bool v) const { d37_set(h, D37_ANCHORED, v ? 1 : 0); }   /* false — падает */
  void set_cast_shadow(bool v) const { d37_set(h, D37_CAST_SHADOW, v ? 1 : 0); }
  /* имя, материал ("plastic", "neon", "glass", "metal", "wood", "brick", "grass", "sand", "ice"…), форма ("block", "ball", "cyl", "wedge") */
  Text name() const { Text t; t.n = d37_get_str(h, D37_NAME, t.b, 511); t.b[t.n] = 0; return t; }
  void set_name(Str s) const { d37_set_str(h, D37_NAME, s.p, s.n); }
  Text material() const { Text t; t.n = d37_get_str(h, D37_MATERIAL, t.b, 511); t.b[t.n] = 0; return t; }
  void set_material(Str s) const { d37_set_str(h, D37_MATERIAL, s.p, s.n); }
  void set_shape(Str s) const { d37_set_str(h, D37_SHAPE, s.p, s.n); }
  void set_text(Str s) const { d37_set_str(h, D37_TEXT, s.p, s.n); }
  Text class_name() const { Text t; t.n = d37_get_str(h, D37_CLASS, t.b, 511); t.b[t.n] = 0; return t; }
  /* дерево объектов */
  Part parent() const { return Part(d37_parent(h)); }
  void set_parent(Part p) const { d37_set_parent(h, p.h); }
  Part find_child(Str name, bool deep = false) const { return Part(d37_find_in(h, name.p, name.n, deep ? 1 : 0)); }
  int child_count() const { return d37_children(h); }
  Part child(int i) const { return Part(d37_child(h, i)); }
#if D37_HOSTED
  std::vector<Part> children() const { std::vector<Part> v; int n = d37_children(h); for (int i = 0; i < n; i++) v.push_back(Part(d37_child(h, i))); return v; }
#endif
  Part clone() const { return Part(d37_clone(h)); }
  void destroy() const { d37_destroy(h); }
  /* плавно */
  Tween tween_position(Vec3 to, TweenInfo i) const { return tw(D37_POSITION, to, i); }
  Tween tween_size(Vec3 to, TweenInfo i) const { return tw(D37_SIZE, to, i); }
  Tween tween_rotation(Vec3 to, TweenInfo i) const { return tw(D37_ROTATION, to, i); }
  Tween tween_color(double r, double g, double b, TweenInfo i) const { return tw(D37_RGB, Vec3(r, g, b), i); }
  Tween tween_transparency(double to, TweenInfo i) const { return tw(D37_ALPHA, Vec3(to, 0, 0), i); }
  Tween tw(int what, Vec3 v, const TweenInfo &i) const { return Tween(d37_tween(h, what, v.x, v.y, v.z, i.time_, (int)i.ease_, i.reverses_ ? 1 : 0, i.repeat_, i.delay_)); }
  /* подсказка «[E] текст» без нового обработчика (поменять текст) */
  void prompt_text(Str text, double hold = 0) const { d37_prompt(h, text.p, text.n, hold, 0); }
  /* события: обработчик получает игрока (Player; если коснулся не игрок — пустой) */
#if D37_HOSTED
  template <class F> Conn on_touched(F f) const { unsigned i = detail::player_box(std::move(f), false); int cb = detail::enc(i, detail::K_BOX); return Conn(detail::bind(i, d37_on_touched(h, cb)), cb); }
  template <class F> Conn on_touch_ended(F f) const { unsigned i = detail::player_box(std::move(f), false); int cb = detail::enc(i, detail::K_BOX); return Conn(detail::bind(i, d37_on_touch_ended(h, cb)), cb); }
  template <class F> Conn on_clicked(F f) const { unsigned i = detail::player_box(std::move(f), false); int cb = detail::enc(i, detail::K_BOX); return Conn(detail::bind(i, d37_on_clicked(h, cb)), cb); }
  template <class F> Conn prompt(Str text, double hold, F f) const { unsigned i = detail::player_box(std::move(f), false); int cb = detail::enc(i, detail::K_BOX); return Conn(detail::bind(i, d37_prompt(h, text.p, text.n, hold, cb)), cb); }
  template <class F> Conn prompt(Str text, F f) const { return prompt(text, 0, std::move(f)); }
#else
  Conn on_touched(void (*f)(Player)) const { int cb = detail::enc(detail::fnum(f), detail::K_PLAYER); return Conn(d37_on_touched(h, cb), cb); }
  Conn on_touch_ended(void (*f)(Player)) const { int cb = detail::enc(detail::fnum(f), detail::K_PLAYER); return Conn(d37_on_touch_ended(h, cb), cb); }
  Conn on_clicked(void (*f)(Player)) const { int cb = detail::enc(detail::fnum(f), detail::K_PLAYER); return Conn(d37_on_clicked(h, cb), cb); }
  Conn prompt(Str text, double hold, void (*f)(Player)) const { int cb = detail::enc(detail::fnum(f), detail::K_PLAYER); return Conn(d37_prompt(h, text.p, text.n, hold, cb), cb); }
  Conn prompt(Str text, void (*f)(Player)) const { return prompt(text, 0, f); }
#endif
};

/* ── Мир ── */
inline Part script_parent() { return Part(d37_script()); }              /* деталь, в которой лежит скрипт */
inline Part find(Str name) { return Part(d37_find(name.p, name.n)); }   /* по имени во всём мире (вглубь) */
inline Part workspace() { return Part(); }
inline Part new_part(Part parent = Part()) { return Part(d37_create(D37_NEW_PART, parent.h)); }
inline Part new_wedge(Part parent = Part()) { return Part(d37_create(D37_NEW_WEDGE, parent.h)); }
inline Part new_light(Part parent = Part()) { return Part(d37_create(D37_NEW_LIGHT, parent.h)); }
inline Part new_model(Part parent = Part()) { return Part(d37_create(D37_NEW_MODEL, parent.h)); }
inline Part event_target() { return Part(d37_event_target()); }        /* чьё событие сейчас обрабатывается */
/* ── Вывод, экран, звук ── */
inline void print(Str s) { d37_print(s.p, s.n); }
inline void warn(Str s) { d37_warn(s.p, s.n); }
inline void error(Str s) { d37_error(s.p, s.n, 0); }
inline void gui_message(Str s, double sec = 3) { d37_gui_message(s.p, s.n, sec); }
inline void gui_text(Str key, Str s) { d37_gui_text(key.p, key.n, s.p, s.n); }
inline void gui_clear(Str key) { d37_gui_clear(key.p, key.n); }
/* звуки: coin jump hit click pickup buzz break keypad door_wood_open door_wood_close door_metal_open build_wood … */
inline void sound(Str name, Part at = Part()) { d37_sound(name.p, name.n, at.h); }
/* ── Случайность и время ── */
inline double random_float() { return d37_random(); }                   /* 0 ≤ x < 1 */
inline int random_int(int a, int b) { return d37_random_int(a, b); }    /* a…b включительно */
inline double game_time() { return d37_time(); }                        /* секунд с начала игры */
/* ── Игроки ── */
inline int player_count() { return d37_players(); }
inline Player player_at(int i) { return Player(d37_player(i)); }
inline Player local_player() { return Player(d37_player(0)); }
#if D37_HOSTED
inline std::vector<Player> players() { std::vector<Player> v; int n = d37_players(); for (int i = 0; i < n; i++) v.push_back(Player(d37_player(i))); return v; }
template <class F> inline Conn on_player_added(F f) { unsigned i = detail::player_box(std::move(f), false); int cb = detail::enc(i, detail::K_BOX); return Conn(detail::bind(i, d37_on_player_added(cb)), cb); }
template <class F> inline Conn on_player_removing(F f) { unsigned i = detail::player_box(std::move(f), false); int cb = detail::enc(i, detail::K_BOX); return Conn(detail::bind(i, d37_on_player_removing(cb)), cb); }
template <class F> inline Conn on_died(F f) { unsigned i = detail::player_box(std::move(f), false); int cb = detail::enc(i, detail::K_BOX); return Conn(detail::bind(i, d37_on_died(cb)), cb); }
/* ── Таймеры и кадр ── */
template <class F> inline Timer delay(double sec, F f) { unsigned i = detail::void_box(std::move(f), true); int cb = detail::enc(i, detail::K_BOX); return Timer(detail::bind(i, d37_delay(sec, cb)), cb); }
template <class F> inline Timer every(double sec, F f) { unsigned i = detail::void_box(std::move(f), false); int cb = detail::enc(i, detail::K_BOX); return Timer(detail::bind(i, d37_every(sec, cb)), cb); }
template <class F> inline void on_update(F f) { detail::updates().push_back(std::function<void(double)>(std::move(f))); d37_want_update(1); }
template <class F> inline Conn Tween::on_done(F f) const { unsigned i = detail::void_box(std::move(f), true); int cb = detail::enc(i, detail::K_BOX); return Conn(detail::bind(i, d37_on_tween_done(host, cb)), cb); }
#else
inline Conn on_player_added(void (*f)(Player)) { int cb = detail::enc(detail::fnum(f), detail::K_PLAYER); return Conn(d37_on_player_added(cb), cb); }
inline Conn on_player_removing(void (*f)(Player)) { int cb = detail::enc(detail::fnum(f), detail::K_PLAYER); return Conn(d37_on_player_removing(cb), cb); }
inline Conn on_died(void (*f)(Player)) { int cb = detail::enc(detail::fnum(f), detail::K_PLAYER); return Conn(d37_on_died(cb), cb); }
inline Timer delay(double sec, void (*f)()) { int cb = detail::enc(detail::fnum(f), detail::K_VOID); return Timer(d37_delay(sec, cb), cb); }
inline Timer every(double sec, void (*f)()) { int cb = detail::enc(detail::fnum(f), detail::K_VOID); return Timer(d37_every(sec, cb), cb); }
inline void on_update(void (*f)(double)) { d37_on_update(f); }
inline Conn Tween::on_done(void (*f)()) const { int cb = detail::enc(detail::fnum(f), detail::K_VOID); return Conn(d37_on_tween_done(host, cb), cb); }
#endif
}  // namespace d37
#endif  /* __cplusplus */

/* ═══ Экспорты модуля: d37_start → start(), d37_event → обработчик, d37_update → каждый кадр ═══ */
#ifndef D37_NO_MAIN
#ifdef __cplusplus
void start();
#else
void start(void);
#endif
#ifndef __wasi__
#ifdef __cplusplus
extern "C" void __wasm_call_ctors(void);
#else
void __wasm_call_ctors(void);
#endif
#endif
D37_EXPORT(d37_start) __attribute__((weak)) void d37_export_start(void) {
#ifndef __wasi__
  __wasm_call_ctors();   /* без libc глобальные конструкторы зовём сами (в WASI это делает _initialize) */
#endif
#if D37_HOSTED
  std::setvbuf(stdout, nullptr, _IONBF, 0);   /* printf — сразу в «Вывод», даже без перевода строки */
  std::setvbuf(stderr, nullptr, _IONBF, 0);
#endif
  start();
}
D37_EXPORT(d37_event) __attribute__((weak)) void d37_export_event(int cb, int arg) {
  unsigned u = (unsigned)cb, k = u & 7u, v = u >> 3;
  if (k == 0) ((void (*)(int))(__UINTPTR_TYPE__)v)(arg);
  else if (k == 1) ((void (*)(void))(__UINTPTR_TYPE__)v)();
#ifdef __cplusplus
  else if (k == 2) ((void (*)(d37::Player))(__UINTPTR_TYPE__)v)(d37::Player(arg));
#if D37_HOSTED
  else if (k == 4) d37::detail::dispatch(v, arg);
#endif
#endif
}
D37_EXPORT(d37_update) __attribute__((weak)) void d37_export_update(double dt) {
  if (d37_upd_fn_ptr) d37_upd_fn_ptr(dt);
#if D37_HOSTED
  std::vector<std::function<void(double)>> &U = d37::detail::updates();
  for (size_t i = 0; i < U.size(); i++) { std::function<void(double)> f = U[i]; f(dt); }
#endif
}
#endif  /* D37_NO_MAIN */
#endif  /* D37_H */

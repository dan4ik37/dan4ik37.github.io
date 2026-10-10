//! d37.rs — SDK «Студии 3D» сайта dan4ik37 для Rust: скрипт — модуль WebAssembly.
//!
//! Положи этот файл рядом с lib.rs (src/d37.rs) и начни lib.rs так:
//!     #[macro_use]
//!     mod d37;
//!     use d37::*;
//!     fn start() { … }        // зовётся один раз при «▶ Играть»
//! Собрать: cargo build --release --target wasm32-unknown-unknown (в Cargo.toml: crate-type = ["cdylib"], panic = "abort")
//! → target/wasm32-unknown-unknown/release/<имя>.wasm → в студии «📦 Загрузить .wasm». Готовый проект — sdk/rust-template.
//! ABI (что зовём у сайта и что сайт зовёт у нас) описан в шапке sdk/d37.h. Нужен Rust 1.82 или новее.
#![allow(dead_code, unused_macros, clippy::should_implement_trait)]

use std::cell::RefCell;

// ═══ Функции сайта (сырые) — модуль импорта "d37" ═══
mod sys {
    #[link(wasm_import_module = "d37")]
    unsafe extern "C" {
        pub fn print(s: *const u8, n: i32);
        pub fn warn(s: *const u8, n: i32);
        pub fn error(s: *const u8, n: i32, line: i32);
        pub fn script() -> i32;
        pub fn find(s: *const u8, n: i32) -> i32;
        pub fn find_in(parent: i32, s: *const u8, n: i32, deep: i32) -> i32;
        pub fn parent(h: i32) -> i32;
        pub fn children(h: i32) -> i32;
        pub fn child(h: i32, i: i32) -> i32;
        pub fn exists(h: i32) -> i32;
        pub fn get(h: i32, prop: i32) -> f64;
        pub fn set(h: i32, prop: i32, v: f64);
        pub fn set3(h: i32, what: i32, x: f64, y: f64, z: f64);
        pub fn get_str(h: i32, which: i32, buf: *mut u8, cap: i32) -> i32;
        pub fn set_str(h: i32, which: i32, s: *const u8, n: i32);
        pub fn create(kind: i32, parent: i32) -> i32;
        pub fn clone(h: i32) -> i32;
        pub fn destroy(h: i32);
        pub fn set_parent(h: i32, parent: i32);
        pub fn tween(h: i32, what: i32, x: f64, y: f64, z: f64, time: f64, ease: i32, reverses: i32, repeat: i32, delay: f64) -> i32;
        pub fn tween_cancel(t: i32);
        pub fn on_tween_done(t: i32, cb: i32) -> i32;
        pub fn on_touched(h: i32, cb: i32) -> i32;
        pub fn on_touch_ended(h: i32, cb: i32) -> i32;
        pub fn on_clicked(h: i32, cb: i32) -> i32;
        pub fn prompt(h: i32, s: *const u8, n: i32, hold: f64, cb: i32) -> i32;
        pub fn on_player_added(cb: i32) -> i32;
        pub fn on_player_removing(cb: i32) -> i32;
        pub fn on_died(cb: i32) -> i32;
        pub fn off(c: i32);
        pub fn want_update(on: i32);
        pub fn event_target() -> i32;
        pub fn delay(sec: f64, cb: i32) -> i32;
        pub fn every(sec: f64, cb: i32) -> i32;
        pub fn cancel(t: i32);
        pub fn random() -> f64;
        pub fn random_int(a: i32, b: i32) -> i32;
        pub fn time() -> f64;
        pub fn players() -> i32;
        pub fn player(i: i32) -> i32;
        pub fn player_name(p: i32, buf: *mut u8, cap: i32) -> i32;
        pub fn pget(p: i32, which: i32) -> f64;
        pub fn pset(p: i32, which: i32, v: f64);
        pub fn stat_get(p: i32, k: *const u8, kn: i32) -> f64;
        pub fn stat_set(p: i32, k: *const u8, kn: i32, v: f64);
        pub fn stat_add(p: i32, k: *const u8, kn: i32, d: f64);
        pub fn teleport(p: i32, x: f64, y: f64, z: f64);
        pub fn message(p: i32, s: *const u8, n: i32, sec: f64);
        pub fn kill(p: i32);
        pub fn respawn(p: i32);
        pub fn gui_message(s: *const u8, n: i32, sec: f64);
        pub fn gui_text(k: *const u8, kn: i32, s: *const u8, n: i32);
        pub fn gui_clear(k: *const u8, kn: i32);
        pub fn sound(s: *const u8, n: i32, at: i32);
    }
}

// номера свойств — как в d37.h
const POS: i32 = 0;
const SIZE: i32 = 3;
const ROT: i32 = 6;
const TRANSPARENCY: i32 = 9;
const CAN_COLLIDE: i32 = 10;
const ANCHORED: i32 = 11;
const COLOR: i32 = 12;
const CAST_SHADOW: i32 = 13;

fn get_text(f: impl FnOnce(*mut u8, i32) -> i32) -> String {
    let mut buf = [0u8; 512];
    let n = f(buf.as_mut_ptr(), buf.len() as i32).clamp(0, buf.len() as i32) as usize;
    String::from_utf8_lossy(&buf[..n]).into_owned()
}

// ═══ Вывод ═══
/// Строка в «Вывод» студии.
pub fn print(text: &str) { unsafe { sys::print(text.as_ptr(), text.len() as i32) } }
/// Жёлтая строка в «Вывод».
pub fn warn(text: &str) { unsafe { sys::warn(text.as_ptr(), text.len() as i32) } }
/// Красная строка (ошибка) в «Вывод».
pub fn error(text: &str) { unsafe { sys::error(text.as_ptr(), text.len() as i32, 0) } }
/// log!("Монеты: {}", n) — как println!, но в «Вывод» студии.
macro_rules! log {
    ($($a:tt)*) => { $crate::d37::print(&format!($($a)*)) };
}

// ═══ Вектор ═══
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
/// vec3(0, 5, 0) — числа можно целые или дробные.
pub fn vec3(x: impl Into<f64>, y: impl Into<f64>, z: impl Into<f64>) -> Vec3 { Vec3 { x: x.into(), y: y.into(), z: z.into() } }
impl Vec3 {
    pub fn length(self) -> f64 { (self.x * self.x + self.y * self.y + self.z * self.z).sqrt() }
}
impl std::ops::Add for Vec3 { type Output = Vec3; fn add(self, o: Vec3) -> Vec3 { Vec3 { x: self.x + o.x, y: self.y + o.y, z: self.z + o.z } } }
impl std::ops::Sub for Vec3 { type Output = Vec3; fn sub(self, o: Vec3) -> Vec3 { Vec3 { x: self.x - o.x, y: self.y - o.y, z: self.z - o.z } } }
impl std::ops::Mul<f64> for Vec3 { type Output = Vec3; fn mul(self, k: f64) -> Vec3 { Vec3 { x: self.x * k, y: self.y * k, z: self.z * k } } }
impl std::ops::Neg for Vec3 { type Output = Vec3; fn neg(self) -> Vec3 { Vec3 { x: -self.x, y: -self.y, z: -self.z } } }
impl std::ops::AddAssign for Vec3 { fn add_assign(&mut self, o: Vec3) { *self = *self + o; } }
impl std::ops::SubAssign for Vec3 { fn sub_assign(&mut self, o: Vec3) { *self = *self - o; } }

// ═══ Плавные изменения ═══
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ease { Linear = 0, Quad = 1, Sine = 2, Back = 3, Bounce = 4, Elastic = 5 }
/// Как плавно: TweenInfo::new(3).ease(Ease::Sine).reverses(true).forever(); вместо него можно просто число секунд.
#[derive(Clone, Copy, Debug)]
pub struct TweenInfo { pub time: f64, pub ease: Ease, pub reverses: bool, pub repeat: i32, pub delay: f64 }
impl TweenInfo {
    pub fn new(time: impl Into<f64>) -> TweenInfo { TweenInfo { time: time.into(), ease: Ease::Quad, reverses: false, repeat: 0, delay: 0.0 } }
    pub fn ease(mut self, e: Ease) -> Self { self.ease = e; self }
    pub fn reverses(mut self, r: bool) -> Self { self.reverses = r; self }
    pub fn repeat(mut self, n: i32) -> Self { self.repeat = n; self }
    pub fn forever(mut self) -> Self { self.repeat = -1; self }
    pub fn delay(mut self, s: impl Into<f64>) -> Self { self.delay = s.into(); self }
}
impl From<f64> for TweenInfo { fn from(t: f64) -> Self { TweenInfo::new(t) } }
impl From<i32> for TweenInfo { fn from(t: i32) -> Self { TweenInfo::new(t) } }
/// Запущенное плавное изменение.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tween(pub i32);
impl Tween {
    pub fn cancel(self) { unsafe { sys::tween_cancel(self.0) } }
    /// Когда закончится (у бесконечного — никогда).
    pub fn on_done(self, f: impl FnOnce() + 'static) -> Conn {
        let mut f = Some(f);
        let slot = keep(Box::new(move |_| { if let Some(f) = f.take() { f() } }), true);
        Conn { host: bind(slot, unsafe { sys::on_tween_done(self.0, cb(slot)) }), slot }
    }
}

/// Подписка на событие: .off() — отписаться. Можно не хранить.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Conn { host: i32, slot: u32 }
impl Conn {
    pub fn off(self) { unsafe { sys::off(self.host) }; release_if(self.slot, self.host); }
}
/// Таймер: .cancel() — отменить.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Timer { host: i32, slot: u32 }
impl Timer {
    pub fn cancel(self) { unsafe { sys::cancel(self.host) }; release_if(self.slot, self.host); }
}

// ═══ Деталь (и любой объект мира) ═══
/// Номер объекта мира. Part(0) — нет детали (или Workspace).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Part(pub i32);
/// Workspace — корень мира (как родитель).
pub const WORKSPACE: Part = Part(0);
fn opt(h: i32) -> Option<Part> { if h != 0 { Some(Part(h)) } else { None } }
impl Part {
    pub fn exists(self) -> bool { self.0 != 0 && unsafe { sys::exists(self.0) } != 0 }
    fn get3(self, k: i32) -> Vec3 { unsafe { Vec3 { x: sys::get(self.0, k), y: sys::get(self.0, k + 1), z: sys::get(self.0, k + 2) } } }
    pub fn position(self) -> Vec3 { self.get3(POS) }
    pub fn set_position(self, v: Vec3) { unsafe { sys::set3(self.0, 0, v.x, v.y, v.z) } }
    pub fn size(self) -> Vec3 { self.get3(SIZE) }
    pub fn set_size(self, v: Vec3) { unsafe { sys::set3(self.0, 1, v.x, v.y, v.z) } }
    /// Поворот в градусах.
    pub fn rotation(self) -> Vec3 { self.get3(ROT) }
    pub fn set_rotation(self, v: Vec3) { unsafe { sys::set3(self.0, 2, v.x, v.y, v.z) } }
    /// Цвет: r, g, b от 0 до 1.
    pub fn color(self) -> Vec3 {
        let c = unsafe { sys::get(self.0, COLOR) } as u32;
        Vec3 { x: ((c >> 16) & 255) as f64 / 255.0, y: ((c >> 8) & 255) as f64 / 255.0, z: (c & 255) as f64 / 255.0 }
    }
    pub fn set_color(self, r: impl Into<f64>, g: impl Into<f64>, b: impl Into<f64>) { unsafe { sys::set3(self.0, 3, r.into(), g.into(), b.into()) } }
    /// 0xff0000 — красный.
    pub fn set_color_hex(self, hex: u32) { unsafe { sys::set(self.0, COLOR, (hex & 0xffffff) as f64) } }
    pub fn transparency(self) -> f64 { unsafe { sys::get(self.0, TRANSPARENCY) } }
    pub fn set_transparency(self, v: impl Into<f64>) { unsafe { sys::set(self.0, TRANSPARENCY, v.into()) } }
    pub fn can_collide(self) -> bool { unsafe { sys::get(self.0, CAN_COLLIDE) != 0.0 } }
    pub fn set_can_collide(self, v: bool) { unsafe { sys::set(self.0, CAN_COLLIDE, v as i32 as f64) } }
    pub fn anchored(self) -> bool { unsafe { sys::get(self.0, ANCHORED) != 0.0 } }
    /// false — деталь падает.
    pub fn set_anchored(self, v: bool) { unsafe { sys::set(self.0, ANCHORED, v as i32 as f64) } }
    pub fn set_cast_shadow(self, v: bool) { unsafe { sys::set(self.0, CAST_SHADOW, v as i32 as f64) } }
    pub fn name(self) -> String { get_text(|b, n| unsafe { sys::get_str(self.0, 0, b, n) }) }
    pub fn set_name(self, s: &str) { unsafe { sys::set_str(self.0, 0, s.as_ptr(), s.len() as i32) } }
    pub fn material(self) -> String { get_text(|b, n| unsafe { sys::get_str(self.0, 1, b, n) }) }
    /// "plastic", "neon", "glass", "metal", "wood", "brick", "grass", "sand", "ice"…
    pub fn set_material(self, s: &str) { unsafe { sys::set_str(self.0, 1, s.as_ptr(), s.len() as i32) } }
    /// "block", "ball", "cyl", "wedge".
    pub fn set_shape(self, s: &str) { unsafe { sys::set_str(self.0, 2, s.as_ptr(), s.len() as i32) } }
    pub fn set_text(self, s: &str) { unsafe { sys::set_str(self.0, 3, s.as_ptr(), s.len() as i32) } }
    pub fn class_name(self) -> String { get_text(|b, n| unsafe { sys::get_str(self.0, 4, b, n) }) }
    /// Родитель (None — лежит прямо в Workspace).
    pub fn parent(self) -> Option<Part> { opt(unsafe { sys::parent(self.0) }) }
    /// Переложить в другой объект (None — в Workspace).
    pub fn set_parent(self, p: Option<Part>) { unsafe { sys::set_parent(self.0, p.map_or(0, |p| p.0)) } }
    pub fn find_child(self, name: &str) -> Option<Part> { opt(unsafe { sys::find_in(self.0, name.as_ptr(), name.len() as i32, 0) }) }
    pub fn find_descendant(self, name: &str) -> Option<Part> { opt(unsafe { sys::find_in(self.0, name.as_ptr(), name.len() as i32, 1) }) }
    pub fn children(self) -> Vec<Part> { let n = unsafe { sys::children(self.0) }; (0..n).map(|i| Part(unsafe { sys::child(self.0, i) })).collect() }
    /// Копия объекта в мире (как Clone в Roblox).
    pub fn clone(self) -> Part { Part(unsafe { sys::clone(self.0) }) }
    pub fn destroy(self) { unsafe { sys::destroy(self.0) } }
    fn tween(self, what: i32, v: Vec3, i: TweenInfo) -> Tween {
        Tween(unsafe { sys::tween(self.0, what, v.x, v.y, v.z, i.time, i.ease as i32, i.reverses as i32, i.repeat, i.delay) })
    }
    pub fn tween_position(self, to: Vec3, info: impl Into<TweenInfo>) -> Tween { self.tween(0, to, info.into()) }
    pub fn tween_size(self, to: Vec3, info: impl Into<TweenInfo>) -> Tween { self.tween(1, to, info.into()) }
    pub fn tween_rotation(self, to: Vec3, info: impl Into<TweenInfo>) -> Tween { self.tween(2, to, info.into()) }
    /// Цвет: vec3(r, g, b) от 0 до 1.
    pub fn tween_color(self, rgb: Vec3, info: impl Into<TweenInfo>) -> Tween { self.tween(3, rgb, info.into()) }
    pub fn tween_transparency(self, to: impl Into<f64>, info: impl Into<TweenInfo>) -> Tween { self.tween(4, vec3(to, 0, 0), info.into()) }
    /// Коснулся игрок (Some) или что-то другое (None).
    pub fn on_touched(self, f: impl FnMut(Option<Player>) + 'static) -> Conn { let s = opt_player_cb(f); Conn { host: bind(s, unsafe { sys::on_touched(self.0, cb(s)) }), slot: s } }
    pub fn on_touch_ended(self, f: impl FnMut(Option<Player>) + 'static) -> Conn { let s = opt_player_cb(f); Conn { host: bind(s, unsafe { sys::on_touch_ended(self.0, cb(s)) }), slot: s } }
    pub fn on_clicked(self, f: impl FnMut(Player) + 'static) -> Conn { let s = player_cb(f); Conn { host: bind(s, unsafe { sys::on_clicked(self.0, cb(s)) }), slot: s } }
    /// Подсказка «[E] текст»: нажал — f(игрок).
    pub fn prompt(self, text: &str, f: impl FnMut(Player) + 'static) -> Conn { self.prompt_hold(text, 0, f) }
    /// То же, но держать кнопку hold секунд.
    pub fn prompt_hold(self, text: &str, hold: impl Into<f64>, f: impl FnMut(Player) + 'static) -> Conn {
        let s = player_cb(f);
        Conn { host: bind(s, unsafe { sys::prompt(self.0, text.as_ptr(), text.len() as i32, hold.into(), cb(s)) }), slot: s }
    }
    /// Поменять текст подсказки «[E] …».
    pub fn prompt_text(self, text: &str) { unsafe { sys::prompt(self.0, text.as_ptr(), text.len() as i32, 0.0, 0) }; }
}

/// Деталь, в которой лежит скрипт (Part(0) — скрипт лежит в Workspace).
pub fn script_parent() -> Part { Part(unsafe { sys::script() }) }
/// Поиск по имени во всём мире.
pub fn find(name: &str) -> Option<Part> { opt(unsafe { sys::find(name.as_ptr(), name.len() as i32) }) }
/// Новая деталь (None — в Workspace).
pub fn new_part(parent: Option<Part>) -> Part { Part(unsafe { sys::create(0, parent.map_or(0, |p| p.0)) }) }
pub fn new_wedge(parent: Option<Part>) -> Part { Part(unsafe { sys::create(1, parent.map_or(0, |p| p.0)) }) }
pub fn new_light(parent: Option<Part>) -> Part { Part(unsafe { sys::create(2, parent.map_or(0, |p| p.0)) }) }
pub fn new_model(parent: Option<Part>) -> Part { Part(unsafe { sys::create(3, parent.map_or(0, |p| p.0)) }) }
/// Чьё событие сейчас обрабатывается (для одного обработчика на много деталей).
pub fn event_target() -> Option<Part> { opt(unsafe { sys::event_target() }) }

// ═══ Игрок ═══
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Player(pub i32);
impl Player {
    pub fn name(self) -> String { get_text(|b, n| unsafe { sys::player_name(self.0, b, n) }) }
    pub fn health(self) -> f64 { unsafe { sys::pget(self.0, 0) } }
    pub fn set_health(self, v: impl Into<f64>) { unsafe { sys::pset(self.0, 0, v.into()) } }
    pub fn max_health(self) -> f64 { unsafe { sys::pget(self.0, 1) } }
    pub fn set_max_health(self, v: impl Into<f64>) { unsafe { sys::pset(self.0, 1, v.into()) } }
    pub fn damage(self, n: impl Into<f64>) { let n: f64 = n.into(); self.set_health(self.health() - n.max(0.0)); }
    /// Скорость шага (обычно 16).
    pub fn walk_speed(self) -> f64 { unsafe { sys::pget(self.0, 2) } }
    pub fn set_walk_speed(self, v: impl Into<f64>) { unsafe { sys::pset(self.0, 2, v.into()) } }
    /// Сила прыжка (обычно 50).
    pub fn jump_power(self) -> f64 { unsafe { sys::pget(self.0, 3) } }
    pub fn set_jump_power(self, v: impl Into<f64>) { unsafe { sys::pset(self.0, 3, v.into()) } }
    pub fn position(self) -> Vec3 { unsafe { Vec3 { x: sys::pget(self.0, 4), y: sys::pget(self.0, 5), z: sys::pget(self.0, 6) } } }
    pub fn teleport(self, v: Vec3) { unsafe { sys::teleport(self.0, v.x, v.y, v.z) } }
    /// Очки в таблице (leaderstats).
    pub fn stat(self, k: &str) -> f64 { unsafe { sys::stat_get(self.0, k.as_ptr(), k.len() as i32) } }
    pub fn set_stat(self, k: &str, v: impl Into<f64>) { unsafe { sys::stat_set(self.0, k.as_ptr(), k.len() as i32, v.into()) } }
    pub fn add_stat(self, k: &str, d: impl Into<f64>) { unsafe { sys::stat_add(self.0, k.as_ptr(), k.len() as i32, d.into()) } }
    /// Сообщение этому игроку на sec секунд.
    pub fn message(self, text: &str, sec: impl Into<f64>) { unsafe { sys::message(self.0, text.as_ptr(), text.len() as i32, sec.into()) } }
    pub fn kill(self) { unsafe { sys::kill(self.0) } }
    pub fn respawn(self) { unsafe { sys::respawn(self.0) } }
}
pub fn players() -> Vec<Player> { let n = unsafe { sys::players() }; (0..n).map(|i| Player(unsafe { sys::player(i) })).collect() }
pub fn local_player() -> Option<Player> { let h = unsafe { sys::player(0) }; if h != 0 { Some(Player(h)) } else { None } }
pub fn on_player_added(f: impl FnMut(Player) + 'static) -> Conn { let s = player_cb(f); Conn { host: bind(s, unsafe { sys::on_player_added(cb(s)) }), slot: s } }
pub fn on_player_removing(f: impl FnMut(Player) + 'static) -> Conn { let s = player_cb(f); Conn { host: bind(s, unsafe { sys::on_player_removing(cb(s)) }), slot: s } }
pub fn on_died(f: impl FnMut(Player) + 'static) -> Conn { let s = player_cb(f); Conn { host: bind(s, unsafe { sys::on_died(cb(s)) }), slot: s } }

// ═══ Время, таймеры, случайность, экран, звук ═══
/// Через sec секунд — один раз.
pub fn delay(sec: impl Into<f64>, f: impl FnOnce() + 'static) -> Timer {
    let mut f = Some(f);
    let s = keep(Box::new(move |_| { if let Some(f) = f.take() { f() } }), true);
    Timer { host: bind(s, unsafe { sys::delay(sec.into(), cb(s)) }), slot: s }
}
/// Каждые sec секунд (не чаще 0,03 с).
pub fn every(sec: impl Into<f64>, mut f: impl FnMut() + 'static) -> Timer {
    let s = keep(Box::new(move |_| f()), false);
    Timer { host: bind(s, unsafe { sys::every(sec.into(), cb(s)) }), slot: s }
}
/// Каждый кадр: f(dt), dt — секунды с прошлого кадра.
pub fn on_update(f: impl FnMut(f64) + 'static) {
    UPDATES.with(|u| u.borrow_mut().push(Box::new(f)));
    unsafe { sys::want_update(1) }
}
/// 0 ≤ x < 1.
pub fn random_float() -> f64 { unsafe { sys::random() } }
/// a…b включительно.
pub fn random_int(a: i32, b: i32) -> i32 { unsafe { sys::random_int(a, b) } }
/// Секунд с начала игры (std::time на сайте нет).
pub fn game_time() -> f64 { unsafe { sys::time() } }
pub fn gui_message(text: &str, sec: impl Into<f64>) { unsafe { sys::gui_message(text.as_ptr(), text.len() as i32, sec.into()) } }
pub fn gui_text(key: &str, text: &str) { unsafe { sys::gui_text(key.as_ptr(), key.len() as i32, text.as_ptr(), text.len() as i32) } }
pub fn gui_clear(key: &str) { unsafe { sys::gui_clear(key.as_ptr(), key.len() as i32) } }
/// Звук: "coin", "jump", "hit", "click", "pickup", "buzz", "break", "door_wood_open", "door_wood_close", "build_wood"…
pub fn sound(name: &str) { unsafe { sys::sound(name.as_ptr(), name.len() as i32, 0) } }
pub fn sound_at(name: &str, at: Part) { unsafe { sys::sound(name.as_ptr(), name.len() as i32, at.0) } }

// ═══ Обработчики: замыкания хранятся тут, сайту уходит номер ячейки; host — номер подписки/таймера у сайта (уникален) ═══
struct Slot { f: Option<Box<dyn FnMut(i32)>>, host: i32, once: bool, used: bool }
thread_local! {
    static SLOTS: RefCell<Vec<Slot>> = const { RefCell::new(Vec::new()) };
    static SPARE: RefCell<Vec<u32>> = const { RefCell::new(Vec::new()) };
    static UPDATES: RefCell<Vec<Box<dyn FnMut(f64)>>> = const { RefCell::new(Vec::new()) };
}
fn keep(f: Box<dyn FnMut(i32)>, once: bool) -> u32 {
    let i = SPARE.with(|s| s.borrow_mut().pop());
    SLOTS.with(|s| {
        let mut s = s.borrow_mut();
        let slot = Slot { f: Some(f), host: 0, once, used: true };
        match i {
            Some(i) => { s[i as usize] = slot; i }
            None => { s.push(slot); (s.len() - 1) as u32 }
        }
    })
}
fn bind(i: u32, host: i32) -> i32 { SLOTS.with(|s| { if let Some(sl) = s.borrow_mut().get_mut(i as usize) { sl.host = host; } }); host }
fn release(i: u32) {
    let ok = SLOTS.with(|s| match s.borrow_mut().get_mut(i as usize) { Some(sl) if sl.used => { sl.f = None; sl.host = 0; sl.used = false; true } _ => false });
    if ok { SPARE.with(|s| s.borrow_mut().push(i)); }
}
fn release_if(i: u32, host: i32) {
    let mine = SLOTS.with(|s| s.borrow().get(i as usize).is_some_and(|sl| sl.used && sl.host == host));
    if mine { release(i); }
}
fn cb(slot: u32) -> i32 { slot as i32 + 1 }
fn player_cb(mut f: impl FnMut(Player) + 'static) -> u32 { keep(Box::new(move |a| f(Player(a))), false) }
fn opt_player_cb(mut f: impl FnMut(Option<Player>) + 'static) -> u32 { keep(Box::new(move |a| f(if a != 0 { Some(Player(a)) } else { None })), false) }

// ═══ Экспорты: их зовёт сайт ═══
#[unsafe(no_mangle)]
pub extern "C" fn d37_start() {
    // паника → красная строка в «Вывод» с номером строки lib.rs
    std::panic::set_hook(Box::new(|info| {
        let p = info.payload();
        let msg = if let Some(s) = p.downcast_ref::<&str>() { s.to_string() } else if let Some(s) = p.downcast_ref::<String>() { s.clone() } else { String::from("причина неизвестна") };
        let (file, line) = info.location().map_or(("?", 0), |l| (l.file(), l.line()));
        let text = format!("паника: {} ({}:{})", msg, file, line);
        let mine = file.ends_with("lib.rs") || file.ends_with("main.rs");
        unsafe { sys::error(text.as_ptr(), text.len() as i32, if mine { line as i32 } else { 0 }) }
    }));
    crate::start();
}
#[unsafe(no_mangle)]
pub extern "C" fn d37_event(cb: i32, arg: i32) {
    let i = (cb as u32).wrapping_sub(1);   // номер ячейки + 1 (0 у сайта — «без обработчика»)
    let taken = SLOTS.with(|s| match s.borrow_mut().get_mut(i as usize) { Some(sl) if sl.used => sl.f.take().map(|f| (f, sl.host, sl.once)), _ => None });
    let Some((mut f, host, once)) = taken else { return };
    if once { release(i); }   // освобождаем до вызова: обработчик может завести новый таймер
    f(arg);
    if !once {
        SLOTS.with(|s| { if let Some(sl) = s.borrow_mut().get_mut(i as usize) { if sl.used && sl.host == host && sl.f.is_none() { sl.f = Some(f); } } });
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn d37_update(dt: f64) {
    let mut list = UPDATES.with(|u| std::mem::take(&mut *u.borrow_mut()));
    for f in list.iter_mut() { f(dt); }
    UPDATES.with(|u| { let mut u = u.borrow_mut(); let added = std::mem::take(&mut *u); *u = list; u.extend(added); });
}

// Скрипт на Rust для «Студии 3D» сайта dan4ik37 — шаблон. Положи скрипт в деталь и загрузи .wasm.
// Собрать: cargo build --release --target wasm32-unknown-unknown
// Файл: target/wasm32-unknown-unknown/release/d37_script.wasm → в студии «📦 Загрузить .wasm».
// Что умеет SDK — src/d37.rs (те же функции, что у C++: script_parent, find, on_touched, delay, on_update…).
#[macro_use]
mod d37;
use d37::*;

// start() вызывается один раз, когда нажали «▶ Играть»
fn start() {
    let part = script_parent();
    log!("Привет из Rust! Я в детали «{}»", part.name());

    // коснулся игрок — очко и новый цвет
    part.on_touched(move |player| {
        if let Some(p) = player {
            p.add_stat("Касания", 1);
            part.set_color(random_float(), random_float(), random_float());
            sound("click");
        }
    });

    // [E] — деталь подпрыгивает
    let home = part.position();
    part.prompt("Подбросить", move |p| {
        part.tween_position(home + vec3(0, 3, 0), TweenInfo::new(0.4).ease(Ease::Back).reverses(true));
        p.message("Оп!", 1);
    });

    // каждый кадр — медленно крутится
    on_update(move |dt| {
        let r = part.rotation();
        part.set_rotation(vec3(r.x, (r.y + 30.0 * dt) % 360.0, r.z));
    });

    // через 3 секунды — сообщение всем
    delay(3, || gui_message("Скрипт на Rust работает!", 3));
}

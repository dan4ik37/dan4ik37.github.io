// Крутилка: вращается всегда — 90° в секунду
#[macro_use]
mod d37;
use d37::*;

fn start() {
    let part = script_parent();
    on_update(move |dt| {              // каждый кадр; dt — секунды с прошлого кадра
        let r = part.rotation();
        part.set_rotation(vec3(r.x, (r.y + 90.0 * dt) % 360.0, r.z));
    });
}

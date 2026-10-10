// Дверь: [E] открыть / закрыть. Положи в деталь-дверь
#[macro_use]
mod d37;
use d37::*;

fn start() {
    let door = script_parent();
    let closed = door.position();
    let mut open = false;
    door.prompt("Открыть дверь", move |_player| {
        open = !open;
        let to = if open { closed + vec3(0, door.size().y, 0) } else { closed };
        door.tween_position(to, 0.6);
        door.prompt_text(if open { "Закрыть дверь" } else { "Открыть дверь" });
        sound(if open { "door_wood_open" } else { "door_wood_close" });
    });
}

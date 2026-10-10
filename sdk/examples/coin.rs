// Монетка: +1 очко и исчезает. Положи скрипт в деталь-монетку
#[macro_use]
mod d37;
use d37::*;

fn start() {
    let coin = script_parent();
    coin.on_touched(move |player| {
        if let Some(p) = player {        // None — коснулся не игрок
            p.add_stat("Монеты", 1);
            sound("coin");
            coin.destroy();
        }
    });
}

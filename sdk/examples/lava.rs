// Лава: касание — смерть. Положи в красную деталь (материал «Неон»)
#[macro_use]
mod d37;
use d37::*;

fn start() {
    script_parent().on_touched(|player| {
        if let Some(p) = player {
            p.set_health(0);
        }
    });
}

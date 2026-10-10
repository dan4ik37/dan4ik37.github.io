// Дверь: [E] открыть / закрыть. Положи в деталь-дверь
#include "d37.h"
using namespace d37;

Part door;
Vec3 closed;
bool isOpen = false;

void start() {
  door = script_parent();
  closed = door.position();
  door.prompt("Открыть дверь", [](Player p) {
    isOpen = !isOpen;
    Vec3 to = isOpen ? closed + Vec3(0, door.size().y, 0) : closed;
    door.tween_position(to, 0.6);
    door.prompt_text(isOpen ? "Закрыть дверь" : "Открыть дверь");
    sound(isOpen ? "door_wood_open" : "door_wood_close");
  });
}

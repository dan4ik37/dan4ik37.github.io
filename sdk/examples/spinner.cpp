// Крутилка: вращается всегда — 90° в секунду
#include "d37.h"
using namespace d37;

Part part;

void start() {
  part = script_parent();
  on_update([](double dt) {          // каждый кадр; dt — секунды с прошлого кадра
    Vec3 r = part.rotation();
    double y = r.y + 90 * dt;
    if (y >= 360) y -= 360;
    part.set_rotation(r.x, y, r.z);
  });
}

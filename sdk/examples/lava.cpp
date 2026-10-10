// Лава: касание — смерть. Положи в красную деталь (материал «Неон»)
#include "d37.h"
using namespace d37;

void start() {
  script_parent().on_touched([](Player p) {
    if (p) p.set_health(0);
  });
}

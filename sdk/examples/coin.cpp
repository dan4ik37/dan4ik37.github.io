// Монетка: +1 очко и исчезает. Положи скрипт в деталь-монетку
#include "d37.h"   // на сайте подключается сам
using namespace d37;

void start() {
  Part coin = script_parent();
  coin.on_touched([coin](Player p) {
    if (!p) return;              // коснулся не игрок
    p.add_stat("Монеты", 1);
    sound("coin");
    coin.destroy();
  });
}

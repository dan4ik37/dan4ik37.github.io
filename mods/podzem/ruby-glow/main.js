// Пример мода на JavaScript для «Подземья» (API версии 1 — docs/MODS.md).
// Есть: mod, world, fx, npc, commands, player, game. Сети, сайта и страницы — нет (песочница).
let found = 0;

// Рубин добыт: искры, звук, подсказка с первого раза
mod.on('tileBreak', e => {
  if (e.tile !== 'ruby-glow:ruby_ore') return;
  found++;
  fx.particles(e.x + 0.5, e.y + 0.5, 'spark', 16, '#ff4060');
  fx.sound('coin');
  if (found === 1) player.message('💎 Первый рубин! Из 8 рубинов и 4 серебряных слитков на наковальне — рубиновый меч.');
  if (found % 10 === 0) fx.text(e.x + 0.5, e.y, `Рубинов: ${found}`, '#ff8090');
});

// Поставил лампу — маленький салют
mod.on('tilePlace', e => {
  if (e.tile === 'ruby-glow:ruby_lamp') fx.particles(e.x + 0.5, e.y + 0.5, 'magic', 8, '#ff4060');
});

// Ночью лампы рядом с игроком мерцают (окно мира вокруг игрока приходит с событием tick)
mod.on('tick', () => {
  if (!world.isNight()) return;
  const v = world.view();
  if (!v) return;
  for (let k = 0; k < 30; k++) {
    const x = v.x0 + Math.floor(Math.random() * v.w), y = v.y0 + Math.floor(Math.random() * v.h);
    if (world.get(x, y) === 'ruby-glow:ruby_lamp') fx.particles(x + 0.5, y + 0.3, 'magic', 2, '#ff6080');
  }
});

// Проводник знает про рубины
npc.addLine('Глубже 75 метров в камне попадаются рубины — они светятся красным. Ищи их в темноте!');

// Команда /рубины
commands.add('рубины', 'сколько рубинов добыто', () => player.message(`Добыто рубинов: ${found}`));

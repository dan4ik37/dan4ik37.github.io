# Моды для «Кубомира» — инструкция для авторов

Мод добавляет в «Кубомир» новые **блоки**, **вещи**, **рецепты**, **руды и постройки мира** и **поведение** (скрипты на
JavaScript или Lua). Ничего устанавливать на компьютер не нужно: мод — это обычные текстовые файлы и картинки.

Готовые примеры есть прямо в игре: «🧊 Кубомир» → «🧩 Моды» → «📦 Примеры». Кнопка «📤» скачивает пример файлом —
открой его архиватором и посмотри, как он устроен. Все три примера целиком — в конце этой инструкции.

## 1. Из чего состоит мод

```
rubies/              ← папка мода (или архив rubies.d37mod — это обычный zip с этими файлами)
  mod.json           ← описание мода (обязательно, в корне)
  rubies.js          ← скрипт (необязательно)
  tex/ruby.png       ← картинки 16×16 (необязательно — текстуры можно «нарисовать» прямо в mod.json)
```

Как поставить: «🧩 Моды» → «📥 Добавить мод» (файл `.d37mod`, `.zip` или один `mod.json`), «📁 Папка с модом» или просто
перетащи файл на окно. Потом включи мод галочкой при создании мира (или в игре: меню → «🧩 Моды мира» → «🔄 Применить»).
Мод хранится в браузере. Моды мира попадают и в файл мира (`📤 Сохранить файл мира`) — друг откроет мир сразу с ними.

Ограничения: мод — до 4 МБ, картинка — до 64 КБ, скрипт — до 200 КБ, до 64 блоков, 128 вещей, 256 рецептов, 16 фич и
8 скриптов.

## 2. mod.json

```json
{
  "id": "rubies",
  "name": "Рубины",
  "version": "1.0.0",
  "api": 1,
  "game": "voxel",
  "author": "Денчик37",
  "description": "Рубиновая руда, кирка и меч.",
  "textures": { },
  "blocks": [ ],
  "items": [ ],
  "recipes": [ ],
  "features": [ ],
  "scripts": [ ]
}
```

| Поле | Что это |
|---|---|
| `id` | Имя мода: латиница, цифры и `_`, 2–32 знака, с буквы. Должно быть уникальным — по нему мод узнаётся при обновлении. |
| `name`, `version`, `author`, `description` | Как показывать мод игрокам. |
| `api` | Версия возможностей игры, под которую написан мод. Сейчас — `1`. Мод с бо́льшим номером игра не загрузит (попросит обновить страницу). |
| `game` | `"voxel"` — «Кубомир» (3D), `"tiles"` — 2D-песочница, `"both"` — обе. Формат у игр общий; мод `"tiles"` «Кубомир» не загрузит. |
| `textures`, `blocks`, `items`, `recipes`, `features`, `scripts` | См. ниже. Любое можно не писать. |

**Имена.** Внутри мода свои блоки и вещи можно называть коротко: `"ruby"`. В игре у них всегда приставка мода:
`rubies:ruby` (так они видны в `/give`, в скриптах и в других модах). Блоки и вещи самой игры — без приставки: `stone`,
`stick`, `planks_oak`. Вещь другого мода — с его приставкой: `othermod:gem` (без того мода такой рецепт просто не появится).
У блоков и вещей одного мода имена общие — `ruby` не может быть сразу и блоком, и вещью.

## 3. Текстуры

Все текстуры — 16×16 пикселей. Три способа:

```json
"textures": {
  "ruby_ore":   { "draw": { "k": "ore", "c": "#e0115f", "n": 5 } },
  "ruby":       { "png": "tex/ruby.png" },
  "ruby_block": "tex/ruby_block.png",
  "tiny":       "data:image/png;base64,iVBORw0KGgo..."
}
```

* `png` — картинка из папки мода (PNG до 64 КБ; если она не 16×16 — уменьшится, берётся верхний квадрат);
* `data:image/png;base64,…` — картинка прямо внутри mod.json;
* `draw` — рисунок кодом, без картинок (как у всех блоков игры). `k` — вид рисунка, остальное — его настройки:

| `k` | Что рисует | Настройки |
|---|---|---|
| `noise` | однотонный с шумом (камень, земля) | `c` — цвет, `a` — сила шума (0…1) |
| `ore` | руда: основа + вкрапления | `c` — цвет камешков, `n` — сколько, `base` — основа (`stone`, своя текстура…) |
| `cobble` | булыжник | `c`, `m` — цвет швов, `moss` — мох |
| `planks`, `log`, `log_top` | доски, кора, спил бревна | `c`, у `log_top` ещё `bark`, у `log` — `birch: true` |
| `leaves` | листва с дырочками | `c`, `holes` (0…1) |
| `bricks` | кирпичная кладка | `c`, `m` — раствор |
| `stripes`, `checker`, `dots` | полоски, шашечки, точки | `c`, `c2`, у полосок `vertical: true`, у точек `n` |
| `glass`, `lamp`, `liquid` | стекло, лампа, жидкость | `c`, у жидкости `alpha` |
| `plant` | растение (для формы `cross`) | `c`, или `flower` + `center`, или `sapling: true`, или `bush: true` |
| `gem`, `ingot`, `lump`, `stick`, `feather` | вещи: камень, слиток, комок, палка, перо | `c` |
| `tool` | инструмент | `tool`: `pick`, `axe`, `shovel`, `sword`; `c` — цвет металла |
| `food` | еда | `c`, `bone: true`, `leaf: true` |
| `torch`, `ladder`, `door`, `table`, `furnace`, `chest` | как у игры | — |

Цвета — `"#rrggbb"`. Можно брать и текстуры игры по имени: `stone`, `cobble`, `dirt`, `grass_top`, `grass_side`, `sand`,
`gravel`, `planks_oak`, `planks_birch`, `planks_spruce`, `log_oak`, `log_oak_top`, `leaves_oak`, `glass`, `bricks`,
`stone_bricks`, `obsidian`, `iron_block`, `gold_block`, `diamond_block`, `snow`, `ice`, `clay`, `ore_coal`, `ore_iron`,
`ore_gold`, `ore_diamond`, `lamp`, `item_stick`, `item_diamond`, `item_iron_ingot` и др.

## 4. Блоки

```json
"blocks": [
  { "id": "ruby_ore", "name": "Рубиновая руда", "texture": "ruby_ore",
    "hardness": 3, "tool": "pick", "tier": 3, "drops": "ruby" }
]
```

| Поле | По умолчанию | Что это |
|---|---|---|
| `id` | — | имя (латиница, цифры, `_`) |
| `name` | id | название для игроков |
| `texture` | id | текстура: одна `"ruby_ore"` или по граням `{ "top": "…", "side": "…", "bottom": "…", "front": "…" }` |
| `shape` | `"cube"` | форма: `cube` — куб, `cross` — растение крестом, `torch` — как факел, `ladder` — на стене, `cactus` — чуть уже куба, `chest` — как сундук |
| `transparent` | false | куб с прозрачными пикселями (стекло, листва) — соседние грани видны |
| `solid` | true | можно ли сквозь него пройти (`cross` и `torch` — всегда проходимые) |
| `hardness` | 1 | сколько секунд ломать рукой (камень — 1,5, руда — 3, обсидиан — 25; `-1` — не ломается) |
| `tool` | — | чем ломать быстрее: `pick`, `axe`, `shovel`, `sword` |
| `tier` | 0 | какой киркой нужно, чтобы выпал: 1 — деревянной, 2 — каменной, 3 — железной, 4 — алмазной |
| `drops` | сам блок | что выпадает: имя вещи или блока; `null` — ничего |
| `light` | 0 | светит (0…15; факел — 14) |
| `lightBlock` | 0 | сколько света гасит прозрачный блок (0…15) |
| `sound` | `stone` | звук: `stone`, `wood`, `dirt`, `grass`, `sand`, `gravel`, `snow`, `glass`, `metal`, `wool` |
| `bounce` | 0 | подбрасывает того, кто встал (скорость, до 30; батут игры — 15) — **без скрипта** |
| `hurt` | 0 | урон в секунду при касании (кактус — 1) |
| `slip` | 0 | скользкость (лёд — 0,9) |
| `climb` | false | можно лезть, как по лестнице |
| `falls` | false | падает, как песок |
| `replaceable` | false | можно ставить блок поверх (как траву) |
| `axis` | false | поворачивается по оси, как бревно |
| `tint` | — | красится цветом биома: `grass`, `foliage`, `birch`, `spruce` (рисуй текстуру серой) |
| `ui` | — | открывает окно: `craft` — верстак, `chest` — сундук |
| `fuel` | 0 | секунд горения в печи |
| `stack` | 64 | сколько в одной ячейке |

У каждого блока сам собой появляется предмет с тем же именем — его можно ставить.

## 5. Вещи

```json
"items": [
  { "id": "ruby", "name": "Рубин", "texture": "ruby" },
  { "id": "ruby_pick", "name": "Рубиновая кирка", "texture": "ruby_pick",
    "tool": { "type": "pick", "tier": 4, "speed": 10, "durability": 900, "damage": 4 } },
  { "id": "berry", "name": "Ягода", "texture": "berry", "food": { "hunger": 2, "saturation": 1 } }
]
```

* `tool` — инструмент: `type` (`pick`, `axe`, `shovel`, `sword`), `tier` (1 дерево … 4 алмаз), `speed` (дерево 2, камень 4,
  железо 6, алмаз 8, золото 12), `durability` (сколько раз ударить), `damage` (урон мобам). Инструменты не складываются.
* `food` — еда: `hunger` (сколько «окорочков» вернёт, всего их 20), `saturation` (насколько надолго хватит).
* `fuel` — секунд горения в печи; `stack` — сколько в одной ячейке (до 64).

Вещи игры: `stick`, `coal`, `iron_ingot`, `gold_ingot`, `diamond`, `clay_ball`, `brick`, `apple`, `meat_raw`, `meat_cooked`,
`chicken_raw`, `chicken_cooked`, `feather`, `slime_ball`, `door`, инструменты `pick_wood` … `sword_diamond`
(`pick|axe|shovel|sword` + `_wood|_stone|_iron|_gold|_diamond`) и все блоки: `stone`, `cobble`, `dirt`, `grass`, `sand`,
`gravel`, `log_oak`, `planks_oak` (и `_birch`, `_spruce`), `sandstone`, `snow`, `ice`, `clay`, `ore_coal`, `ore_iron`,
`ore_gold`, `ore_diamond`, `glass`, `cactus`, `torch`, `crafting_table`, `furnace`, `chest`, `ladder`, `bricks`,
`stone_bricks`, `lamp`, `obsidian`, `iron_block`, `gold_block`, `diamond_block`, `mossy_cobble`, `bouncer` и др.

## 6. Рецепты

```json
"recipes": [
  { "pattern": ["RRR", " | ", " | "], "key": { "R": "ruby", "|": "stick" }, "result": "ruby_pick" },
  { "type": "shapeless", "ingredients": ["ruby_block"], "result": "ruby", "count": 9 },
  { "type": "smelt", "input": "ruby_ore", "result": "ruby", "time": 6 }
]
```

* **По форме** — `pattern`: до 3 строк по 3 знака (пробел — пустая клетка), `key` — что значит каждый знак. Форму можно
  ставить в любое место сетки; зеркальный вариант тоже подходит (запретить — `"mirror": false`). Рецепт 2×2 работает и в
  инвентаре, 3×3 — только на верстаке.
* **Без формы** — `"type": "shapeless"`, `ingredients` — список (до 9).
* **Печь** — `"type": "smelt"`, `input` → `result`, `time` — секунд.
* `count` — сколько получится (по умолчанию 1).
* Группы: `#planks` — любые доски, `#log` — любое бревно, `#coal` — уголь.

## 7. Фичи генерации мира (руды, россыпи, валуны, столбы, свои деревья)

```json
"features": [
  { "type": "ore", "block": "ruby_ore", "minY": 4, "maxY": 30, "size": 4, "perChunk": 1.5 },
  { "type": "scatter", "block": "crystal", "on": ["stone", "snow"], "biomes": ["snow", "mountains"], "chance": 0.006 },
  { "type": "boulder", "block": "crystal_block", "biomes": ["desert"], "perChunk": 0.15, "radius": 1, "radiusVar": 1 },
  { "type": "column", "block": "crystal_block", "top": "crystal", "biomes": ["snow"], "perChunk": 0.6, "min": 2, "max": 5 },
  { "type": "tree", "log": "log_birch", "leaves": "pink_leaves", "biomes": ["plains"], "perChunk": 0.3, "min": 4, "max": 6, "radius": 2 }
]
```

| `type` | Что делает | Настройки |
|---|---|---|
| `ore` | жилы в камне | `minY`…`maxY` (высота мира 0…127, море — 52), `size` — блоков в жиле, `perChunk` — жил на чанк 16×16, `replace` — в чём (по умолчанию `["stone"]`) |
| `scatter` | блоки на поверхности | `on` — на каком верхнем блоке, `chance` — доля клеток (0…1) |
| `boulder` | шар из блока | `radius` (1…4), `radiusVar` — разброс |
| `column` | столбик | `min`…`max` — высота, `top` — блок сверху |
| `tree` | своё дерево | `log`, `leaves`, `min`…`max` — высота ствола, `radius` кроны (1…3) |

Везде: `biomes` — в каких биомах (`ocean`, `beach`, `plains`, `forest`, `birch`, `desert`, `snow`, `mountains`, `swamp`,
`river`; пусто — во всех), `perChunk` — сколько на чанк (можно дробное: 0,15 — примерно в каждом седьмом чанке).
Мир по зерну остаётся одинаковым у всех, у кого включены те же моды. Без мода мир — тот же самый, только без его блоков.

## 8. Скрипты

```json
"scripts": [ { "file": "rubies.js" }, { "file": "spring.lua" }, { "code": "log('привет')", "lang": "js", "name": "мини" } ]
```

Язык — по расширению файла: `.js` — JavaScript, `.lua` — Lua (как Luau в Roblox: `+=`, `continue`, типы, `` `строки {x}` ``).
Каждый мод работает в своей **песочнице**: отдельный поток без интернета, без доступа к сайту, аккаунту, файлам и другим
модам. Мир скрипт меняет только через API ниже — игра проверяет каждое действие.

### Версия API: 1

**События** — `mod.on(событие, [на что], функция)`:

| Событие | Когда | Данные `e` |
|---|---|---|
| `blockBreak` | игрок сломал блок | `x, y, z, block` |
| `blockPlace` | игрок поставил блок | `x, y, z, block` |
| `use` | правая кнопка по блоку или с вещью в руке (**нужно указать, на что**: имя блока или вещи) | `x, y, z, block, item` |
| `stepOn` | игрок встал на блок или зашёл в него (**нужно указать блок**; не чаще раза в 0,3 с) | `x, y, z, block` |
| `tick` | 4 раза в секунду | вместо `e` — `dt` (секунд прошло) |
| `chat` | игрок написал в чат (не команду) | `text` |
| `playerJoin` | игрок вошёл в мир | — |

У каждого `e` есть `e.player` (то же, что `player`). «На что» — имя или список имён: `'ruby_ore'`, `['ruby_ore', 'stone']`.
Свои имена можно писать коротко, имена игры — как есть. В `e.block` и `e.item` имена всегда полные (`rubies:ruby_ore`).
Обработчик `use` «забирает» нажатие: блок не ставится, сундук не открывается.

**Мир — `world`:**

* `world.get(x, y, z)` → имя блока или `null`. Сразу видно куб 9×9×9 вокруг места события (и вокруг игрока в `tick` и
  командах); дальше — `null`.
* `await world.read(x, y, z)` → имя блока где угодно в загруженном мире (с ожиданием; в Lua ждёт само: `local b = world:read(x, y, z)`).
* `world.set(x, y, z, "блок")` — поставить блок (`"air"` — убрать). Только рядом с игроком (до 96 блоков) и в загруженном мире;
  не больше 256 за одно событие и 2048 в секунду.
* `world.time()` → часы (0…24), `world.day()` → `true` днём.
* `world.particles(вид, x, y, z, сколько)` — `spark`, `smoke`, `fire`, `magic`, `heart` (до 40 за раз).
* `world.sound(имя, x, y, z)` — `coin`, `click`, `hit`, `break`, `pickup`, `jump`, `land`, `kb_bounce`, `kb_pop`, `kb_place`,
  `kb_eat`, `kb_moo`, `kb_oink`, `kb_cluck`, `kb_groan`, `kb_squish`, `door_wood_open`, `door_wood_close`, `build_wood`.
* `world.spawn(моб, x, y, z)` — `cow`, `pig`, `chicken`, `zombie`, `slime` (до 3 в секунду; в «Мирно» враги не появятся).

**Игрок — `player`:** `player.x`, `.y`, `.z`, `.health` (0…20), `.food`, `.name`, `.mode` (`survival` / `creative`),
`.item` (что в руке), `.sneaking` (присел);
`player.message(текст)` — строка в чат игры (до 5 в секунду), `player.give(вещь, сколько)` (до 10 раз в секунду),
`player.heal(n)`, `player.hurt(n)`, `player.launch(vx, vy, vz)` — толкнуть (до 30; после толчка приземление без урона),
`player.teleport(x, y, z)` — не дальше 128 блоков и только в загруженный мир.

**Мод — `mod`:** `mod.command(имя, функция(args, player))` — своя команда чата `/имя` (команды игры главнее);
`mod.storage.get(ключ)` / `.set(ключ, значение)` / `.remove(ключ)` — запоминается вместе с миром (до 64 КБ);
`mod.wait(секунд)` — ждать (JS: `await mod.wait(1)`; в Lua — `task.wait(1)`); `mod.log(…)` / `log(…)` / в Lua `print(…)` —
в журнал мода («🧩 Моды мира») и в чат; `mod.id`, `mod.api`.

В Lua всё то же через двоеточие: `mod:on("blockBreak", "ruby_ore", function(e) … end)`, `world:set(x, y, z, "stone")`,
`player:message("…")`; свойства — через точку: `player.x`, `e.block`.

### Ошибки и зависания

Ошибка мода игру не роняет. Ошибка при запуске (например, опечатка в коде) — мод сразу выключается до перезапуска мира.
В обработчиках: первая ошибка — сообщение с файлом и строкой, после 10 ошибок мод выключается. Обработчик, который
работает дольше 0,25 с, тормозит игру — после 5 таких мод выключается. Вечный цикл: поток не отвечает 3 секунды — его
останавливают, мод выключается. Все сообщения — в игре: меню → «🧩 Моды мира» (там же журнал каждого мода).

## 9. Проверка своего мода

1. «🧩 Моды» → «📥 Добавить мод»: если в mod.json ошибка — сразу видно, какая (по-русски, с номером рецепта / именем блока).
2. Создай мир «🎨 Творчество» с модом: вещи мода — во вкладке «🧩 Моды» каталога (Tab), или `/give rubies:ruby 10`.
3. Enter → `/help` — покажет команды модов. F3 — сведения о мире.
4. Поменял файлы — добавь мод ещё раз (тот же `id` — обновится) и перезапусти мир («🧩 Моды мира» → «🔄 Применить»).

Поделиться модом — файлом `.d37mod`. Каталог модов с проверкой модератором появится позже.

---

## Пример 1. Новая руда и инструмент — «Рубины» (JavaScript)

`mod.json`:

```json
{
  "id": "rubies", "name": "Рубины", "version": "1.0.0", "api": 1, "game": "voxel", "author": "Денчик37",
  "description": "Рубиновая руда глубоко под землёй, рубиновая кирка и меч, блок из рубинов.",
  "textures": {
    "ruby_ore":   { "draw": { "k": "ore", "c": "#e0115f", "n": 5 } },
    "ruby":       { "draw": { "k": "gem", "c": "#e0115f" } },
    "ruby_block": { "draw": { "k": "checker", "c": "#e0115f", "c2": "#b50d4d" } },
    "ruby_pick":  { "draw": { "k": "tool", "tool": "pick", "c": "#e0115f" } },
    "ruby_sword": { "draw": { "k": "tool", "tool": "sword", "c": "#e0115f" } }
  },
  "blocks": [
    { "id": "ruby_ore", "name": "Рубиновая руда", "texture": "ruby_ore", "hardness": 3, "tool": "pick", "tier": 3, "drops": "ruby" },
    { "id": "ruby_block", "name": "Рубиновый блок", "texture": "ruby_block", "hardness": 5, "tool": "pick", "tier": 2, "sound": "metal", "light": 4 }
  ],
  "items": [
    { "id": "ruby", "name": "Рубин", "texture": "ruby" },
    { "id": "ruby_pick", "name": "Рубиновая кирка", "texture": "ruby_pick", "tool": { "type": "pick", "tier": 4, "speed": 10, "durability": 900, "damage": 4 } },
    { "id": "ruby_sword", "name": "Рубиновый меч", "texture": "ruby_sword", "tool": { "type": "sword", "tier": 4, "durability": 900, "damage": 8 } }
  ],
  "recipes": [
    { "pattern": ["RRR", " | ", " | "], "key": { "R": "ruby", "|": "stick" }, "result": "ruby_pick" },
    { "pattern": ["R", "R", "|"], "key": { "R": "ruby", "|": "stick" }, "result": "ruby_sword" },
    { "pattern": ["RRR", "RRR", "RRR"], "key": { "R": "ruby" }, "result": "ruby_block" },
    { "type": "shapeless", "ingredients": ["ruby_block"], "result": "ruby", "count": 9 },
    { "type": "smelt", "input": "ruby_ore", "result": "ruby" }
  ],
  "features": [ { "type": "ore", "block": "ruby_ore", "minY": 4, "maxY": 30, "size": 4, "perChunk": 1.5 } ],
  "scripts": [ { "file": "rubies.js" } ]
}
```

`rubies.js`:

```js
// Нашёл рубин — искры, звон и счётчик находок (он хранится в мире)
mod.on('blockBreak', 'ruby_ore', e => {
  world.particles('magic', e.x, e.y, e.z, 16);
  world.sound('coin', e.x, e.y, e.z);
  const n = (mod.storage.get('found') || 0) + 1;
  mod.storage.set('found', n);
  if (n === 1) e.player.message('💎 Первый рубин! Три рубина и две палки — кирка, которая копает быстрее алмазной.');
});

// Команда /rubies — сколько рубинов нашёл в этом мире
mod.command('rubies', (args, player) => {
  player.message('Найдено рубинов: ' + (mod.storage.get('found') || 0));
});
```

## Пример 2. Блок, который подбрасывает, — «Батут» (Lua)

Самый простой способ — без скрипта: у блока `"bounce": 15`. Скрипт нужен, если хочется своего поведения (искры, звук,
«присел — не прыгает», разная сила):

`mod.json`:

```json
{
  "id": "trampoline", "name": "Батут", "version": "1.0.0", "api": 1, "game": "voxel", "author": "Денчик37",
  "description": "Пружинный блок: встань на него — подбросит высоко вверх. Присядь (C), чтобы не прыгать.",
  "textures": { "spring": { "draw": { "k": "stripes", "c": "#ff7a1f", "c2": "#ffd84a" } } },
  "blocks": [ { "id": "spring", "name": "Пружинный блок", "texture": { "top": "spring", "side": "planks_oak", "bottom": "planks_oak" }, "hardness": 0.6, "tool": "axe", "sound": "wool" } ],
  "recipes": [ { "pattern": ["SSS", "PPP"], "key": { "S": "slime_ball", "P": "#planks" }, "result": "spring", "count": 2 } ],
  "scripts": [ { "file": "spring.lua" } ]
}
```

`spring.lua`:

```lua
-- Встал на пружину — подбросить вверх (присел — не подбрасывает)
mod:on("stepOn", "spring", function(e)
  if player.sneaking then return end
  player:launch(0, 17, 0)
  world:particles("spark", e.x, e.y + 1, e.z, 10)
  world:sound("kb_bounce", e.x, e.y, e.z)
end)
```

## Пример 3. Своя фича биома — «Кристальные шипы» (только данные)

```json
{
  "id": "crystals", "name": "Кристальные шипы", "version": "1.0.0", "api": 1, "game": "voxel", "author": "Денчик37",
  "description": "В горах и снегах растут светящиеся кристаллы и кристальные столбы, в пустыне лежат кристальные валуны.",
  "textures": {
    "crystal":       { "draw": { "k": "gem", "c": "#7fd8ff" } },
    "crystal_block": { "draw": { "k": "dots", "c": "#4fa8d8", "c2": "#e8fbff", "n": 16 } }
  },
  "blocks": [
    { "id": "crystal_block", "name": "Кристальный блок", "texture": "crystal_block", "hardness": 1.2, "tool": "pick", "tier": 1, "sound": "glass", "light": 9 },
    { "id": "crystal", "name": "Кристалл", "shape": "cross", "texture": "crystal", "hardness": 0.3, "sound": "glass", "light": 11 }
  ],
  "recipes": [ { "pattern": ["CC", "CC"], "key": { "C": "crystal" }, "result": "crystal_block" } ],
  "features": [
    { "type": "column", "block": "crystal_block", "top": "crystal", "biomes": ["snow", "mountains"], "perChunk": 0.6, "min": 2, "max": 5 },
    { "type": "scatter", "block": "crystal", "on": ["stone", "snow", "snow_grass", "grass"], "biomes": ["snow", "mountains"], "chance": 0.006 },
    { "type": "boulder", "block": "crystal_block", "biomes": ["desert"], "perChunk": 0.15, "radius": 1, "radiusVar": 1 }
  ]
}
```

---

Для разработчиков сайта: проверка формата, zip, реестр и песочница — `js/engine/voxel-mods.js` (`V.mods.validate` можно звать
и без браузера), окно модов — `js/games/kubomir-mods.js`, тесты — `node scripts/voxel-test.cjs` (часть «моды»). Новое в API —
только добавлением (старые моды должны работать), с новым номером `api` в `V.mods.API` и в этой инструкции.

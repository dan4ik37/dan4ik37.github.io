# Java на сайте: что сделано и что дальше

Владелец (15.10.2026): «интегрировать джаву и другой код не просто так — чтобы можно было переносить всё»: моды Minecraft на Java
переносить в «Кубомир» (как Майнкрафт) и «Подземье» (как Террария) почти без правок, без лагов. Готовые .jar Forge/Fabric как есть
не запустить: они вызывают код Mojang, которого у нас нет и который нельзя раздавать.

## Сделано — фаза 1 (15.10.2026)

Язык `java` «☕ Java (как в модах Minecraft)» в «Студии 3D»: `js/engine/lang-java.js` (свой переводчик Java → JavaScript в песочнице
скриптов, как C#), подключён в `js/features/games.js` (GAMES_VER 80), примеры и задание для ИИ — в конце файла. Подробно — CLAUDE.md,
раздел «Студия 3D», пункт «Java». Тест: `node scripts/lang-java-test.cjs` (105).

Заготовки для модов уже в переводчике: режим `mod` (когда `env.script` — API мода: есть `mod` и `world`), типы API модов
(`MODAPI_SRC`), пустой каталог фасада `MC_SRC = []`, крючки `MCG / MCA / MCSTART`, метки `//@@JAVA_MC@@` (песочница) и
`//@@JAVA_PAGE@@` (страница), экспорт `D37Lang.java.registry` (пока `null`). Генератор уже находит классы `implements ModInitializer`,
`@Mod`, `@Mod.EventBusSubscriber`, методы `@SubscribeEvent` (`static $subs`), пропускает клиентское (`@Environment(EnvType.CLIENT)`,
`@OnlyIn(Dist.CLIENT)`), принимает импорт `net.minecraft…`, `net.fabricmc…`, `net.minecraftforge…`, `net.neoforged…`, `org.slf4j…` и
`package` в середине текста (несколько файлов можно склеить в один скрипт).

## Дальше — фаза 2: моды на Java для «Кубомира» и «Подземья» (Fabric / Forge / NeoForge)

**Идея.** Блоки и предметы в наших играх создаёт `mod.json` (docs/MODS.md), поведение — скрипт на API модов. Java-мод делится так же:
1. **Проход регистрации при установке** — `D37E.javaMods.prepare(json | null, files, { game, box }) → Promise<{ ok, json, warnings, errors }>`
   (страница, `//@@JAVA_PAGE@@`). Вход — папка/zip в раскладке Fabric/Forge (`fabric.mod.json` или `META-INF/mods.toml` /
   `neoforge.mods.toml`, `src/main/java/**.java`, `src/main/resources/assets/<ns>/{lang,textures,models}`,
   `data/<ns>/{recipe(s),loot_table(s),tags,worldgen}`) или наш `mod.json` со скриптами `"lang": "java"`. Точку входа мода запускаем
   в песочнице (iframe + поток, CSP без сети — как `frameHtml()` в js/engine/voxel-mods.js; зависла > 3–5 с — отказ), фасад в режиме
   «запись» собирает `Registry.register` / `DeferredRegister` → строим `mod.json`; все `.java` — один скрипт `lang: "java"`, файлы
   склеены через строки `//@@FILE путь` (ошибки — «Файл.java:строка»).
   Перевод чисел: прочность MC h → `hardness = min(2000, round(h × 66.67))` («Кубомир» × 0,015 = секунды); `luminance` 0…15 → `light`
   «#xxxxxx»; звуки блока → `sound`; `noCollision` → `solid: false`; `nonOpaque` → `transparent`; `maxCount` → `stack`; еда
   nutrition/saturationModifier → `food { hunger, saturation = n × m × 2 }`; инструмент: скорость × 10 → `power`, уровень + 1 → `tier`,
   прочность → `durability`; урон меча × 45 / 20; теги `mineable/*`, `needs_*_tool` → `tool` / `tier`; loot_table → `drop`; рецепты
   shaped / shapeless / smelting → `pattern + key` / `ingredients` / `station: "furnace"` (`#minecraft:planks` → `#planks`, в 2D — `wood`);
   модели и PNG → `textures` / `faces`, нет PNG — `draw` по имени; названия — `lang/ru_ru.json`, иначе `en_us.json`; имена — `[a-z0-9_-]{1,32}`.
2. **Фасад в песочнице мода** (`//@@JAVA_MC@@`): классы с именами Yarn + синонимы Mojang (`ResourceLocation` = `Identifier`,
   `Level` = `World`, `BlockBehaviour.Properties` = `AbstractBlock.Settings`, `Component` = `Text` …) поверх API модов:
   - тик: `ServerTickEvents.*`, Forge `TickEvent.ServerTickEvent`, NeoForge `ServerTickEvent.Post` → `tick` (2 раза в секунду; внутри —
     10 тиков Minecraft подряд, `server.getTicks()` +1 каждый);
   - ломание: `PlayerBlockBreakEvents.AFTER/BEFORE`, `Block.onBreak / onBroken`, `BlockEvent.BreakEvent` → `tileBreak` (отменить нельзя);
     постановка: `Block.onPlaced`, `BlockEvent.EntityPlaceEvent` → `tilePlace`;
   - ПКМ: `UseBlockCallback`, `Block.onUse / use / useWithoutItem`, `RightClickBlock` → `use` с фильтром блоков мода (только 3D);
     `Item.use / useOnBlock / useOn`, `UseItemCallback`, `RightClickItem` → `use` + `"use": true` у предмета;
     `Block.onSteppedOn / stepOn` → `stepOn` (3D);
   - `ServerLivingEntityEvents.AFTER_DEATH`, `LivingDeathEvent`, `AttackEntityCallback` (приблизительно) → `mobKill`;
     `SERVER_STARTED`, `ServerPlayConnectionEvents.JOIN`, `ServerStartedEvent`, `PlayerLoggedInEvent` → `start`;
     чат (`ServerMessageEvents.CHAT_MESSAGE`, `ServerChatEvent`) → `chat`; подбор → `pickup`;
   - команды: `CommandRegistrationCallback`, `RegisterCommandsEvent` → `commands.add` (свой маленький Brigadier: literal, argument,
     then, executes, requires; Integer/Long/Double/Float/Bool/String/EntityArgumentType, BlockPos);
   - `world.setBlockState / getBlockState / breakBlock` → `world.set / get`; `playSound / addParticle / spawnParticles` → `fx.*`;
     `sendMessage` → `player.message`; `giveItemStack`, `getInventory().insertStack` → `player.give`; `teleport` → `player.teleport`;
     `setVelocity` → `player.launch` (× 20); `Blocks.X / Items.X` → ключи игры (списки: js/engine/voxel.js, js/games/podzem-core.js
     `TILE_LIST`, `defItem`); `LoggerFactory.getLogger` → `mod.log` (`{}` подставляется).
   - 2D («Подземье»): z нет; там y растёт вниз → в фасаде Y = 263 − y игры (`up()` — выше); фильтров у `mod.on` нет — фильтр в обработчике.
   - Терпимость: член каталога `...` — неизвестные методы переводятся в вызов «во время работы»; неизвестный тип из пакетов Minecraft /
     Fabric / Forge — «непрозрачный» (…Block / …Item → обычный блок / предмет, остальное — понятная ошибка, только если код до него дошёл);
     Forge `addListener(this::onX)` — тип события из параметра метода; конструктор `@Mod` получает `IEventBus`, `ModContainer` по типам.
3. **Крючки загрузчиков** (их файлы правят хозяева; от Java — `prepare` и сам язык):
   - js/engine/voxel-mods.js: `validate()` — принимать `"lang": "java"` и `.java` (~строка 306); `modRuntime` init — `if (d.java) eval(d.java)`
     и для `s.lang === 'java'`: `self.D37Lang.java.run(s.code, { script: API, print, warn: (...a) => mod.log('⚠', ...a) }, { name: s.name,
     error, err, setCurrent(){} })` — как Lua, но без строки-пролога; `runner` — `java: '(' + E.langs.java.worker.toString() + ')();'` (~734).
   - js/games/kubomir-mods.js: подгружать js/engine/lang-java.js (как lang-lua.js, ~158), принимать `.java` и папки Fabric/Forge (~58),
     до `validate` — `await D37E.javaMods.prepare(…)`, подпись «Java».
   - js/games/podzem-mods.js: проверка `lang` (~120), `TEXT` + `java|toml` (~165), ветка в `modRuntime` как у Lua (~266),
     подгрузка lang-java.js и `javaSrc` в init (~405–431).
4. Пример `mods/kubomir/java-ruby/` — раскладка Fabric (`fabric.mod.json` с `"custom": { "d37": { "game": "voxel", … } }`, RubyMod.java:
   блок + предмет + `END_SERVER_TICK` + команда, `lang/ru_ru.json`, рецепт JSON) и раздел docs/MODS.md «Перенос модов из Java
   (Fabric/Forge)»: тот же мод рядом, таблица Fabric ↔ Forge ↔ API сайта, пошагово.
5. Тест `scripts/lang-java-mods-test.cjs`: поддельный API модов (3D и 2D) + настоящий `modRuntime` из voxel-mods.js, пропатченный
   в памяти по крючкам выше (песочница в vm), `prepare` в node через `o.box`.

Черновики (могли пропасть): `E:\claude-tmp\java\scratch\mc-catalog.js` — каталог фасада (~150 типов), `phase2-hooks.patch` — правки
генератора (член `...`, синонимы Mojang в `libName`, «непрозрачные» типы, `evfnX`, шина и типы конструктора у `@Mod`).

## Дальше — фаза 3: готовые .jar (исследование, ≤ 2 ч) → docs/JAVA_MODS_RESEARCH.md

Можно ли запускать байткод простых «контентных» модов Fabric, подставляя вместо классов Minecraft (intermediary: `class_2248` = Block)
наш фасад? Сравнить: свой интерпретатор байткода JVM на JS; TeaVM (Apache-2.0, компиляция .class → JS/Wasm, нужны заглушки классов
Minecraft); CheerpJ (проверить лицензию: коммерческое использование); другие. Размер, скорость, что ломается (рефлексия, миксины,
клиентский код). Право: код и ресурсы Mojang не раздаём; лицензии маппингов — Yarn и intermediary (проверить: CC0?), официальные
маппинги Mojang (проверить условия); лицензия каждого мода. Итог — рекомендация; прототип — только если очевидно выполнимо и чисто.

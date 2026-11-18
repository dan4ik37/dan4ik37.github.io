# Настройки движка D37 — как менять (T-166)

Владелец 18.11: «игры должны уметь автоматически подхватывать новые настройки движка, чтобы не заливать их по сто раз и что-то
для какой-то могло отличаться. Но и мы могли спокойно что-то поменять в игре вдруг».

## Как это устроено (коротко)

Настройка берётся из слоёв, нижний — самый слабый:

| слой | где | кто меняет | когда доходит |
|---|---|---|---|
| 0 встроенные | внутри сборки движка (wasm) | только новая сборка | — |
| 1 общий файл | `d37-config/engine.json` | правка файла + push | у всех игр при следующем запуске; LOOK — и посреди игры (≤ 5 мин или при возврате во вкладку) |
| 2 файл игры | `d37-config/games/<id>.json` (`valley`, `creative`, `wardrobe`, `klet`) | правка файла + push | только эта игра, так же |
| 3 строка в базе | `site_config`, ключ `engine_config` | Supabase, без выкладки | только если `HUB_CONFIG_LIVE = true` (js/core/config.js; сейчас выкл.) |
| 4 отладка | `?tune=cloud_cover:0.6,rim:1.2` в адресе, команда `tune` | разработчик | сразу, только у него |

Wasm (17 МБ) и игры заново НЕ выкладываются: меняется один маленький текстовый файл.

- **LOOK** — вид, темп, бюджеты, качество: применяется сразу, даже посреди игры.
- **RULE** — правила игры (голод, жажда, выносливость, костёр…): берутся при СТАРТЕ мира, пишутся в сохранение и в «привет»
  комнаты; у всех игроков общего мира и у сервера одни и те же (сервер с другими правилами не пускает и говорит почему). Новое
  значение доходит до мира при следующем запуске.
- Все ключи, диапазоны и значения по умолчанию: `d37-config/REFERENCE.md` (сделан движком, ★ — самые полезные).

Безопасность: неизвестный ключ пропускается, число вне диапазона обрезается до края, сломанный файл пропускается целиком — игра
никогда не падает из-за настроек и стартует на нижних слоях. `min_build` / `max_build` в файле — для каких поколений таблицы ключей
он написан (номер `build` — в начале REFERENCE.md): старый движок в кэше у кого-то на телефоне такой файл просто пропустит.
Тест `node scripts/engine-config-test.cjs` (он в общем CI) не пропустит файл с ошибкой или с предупреждением.

## Владельцу: поменять для ВСЕХ игр

1. Открой `d37-config/engine.json` (на GitHub — карандаш «Edit»).
2. Впиши ключ и число в `values`, например `"values": { "cloud_cover": 0.6 }` (ключи — из REFERENCE.md).
3. Сохрани (commit в main). Через минуту у всех: LOOK — сразу, RULE — со следующего запуска мира.

## Владельцу: поменять для ОДНОЙ игры

1. Открой `d37-config/games/valley.json` (или `creative`, `wardrobe`, `klet`).
2. Впиши только отличия этой игры: `"values": { "hunger_days": 3 }`.
3. Сохрани. Остальные игры не меняются.
   Вернуть игру на старый движок: в том же файле `"engine": { "channel": "preview" }` (папка /d37-preview/) или
   `"engine": { "build": "4bea8e710c" }` (точная сборка — если она есть в /d37/, /d37-preview/ или /d37-builds/<id>/).

## Владельцу: поменять МГНОВЕННО (без выкладки)

1. Один раз: попроси включить `HUB_CONFIG_LIVE = true` (js/core/config.js).
2. В Supabase → Table Editor → `site_config`: строка с ключом `engine_config`, значение — тот же текст, что в файле:
   `{"format":1,"values":{"cloud_cover":0.6}}`. SQL не нужен: таблица уже есть, читать её могут все, писать — только админ.
3. У игроков — при следующем запуске игры. Убрать: удалить строку.

## Откат

Вернуть один файл к прошлой версии (git revert / «History» на GitHub) — и всё. Строку в базе — удалить.

## For agents

- Key table: `crates/d37-app/src/config.rs` (LOOK keys = `d37_render::tuning::PARAMS`, RULE keys = `RULES`, defaults from
  `assets/game/vitals/tuning.ron`). New key: one row there; bump `BUILD` only when a key changes meaning.
- Before a push: `d37 config check d37-config/engine.json d37-config/games/*.json` (exit 1 on any warning) or
  `node scripts/engine-config-test.cjs` (uses the engine's own wasm `config_check` when d37/ has it, else `keys.json`).
- Reference and validator table are generated: `scripts/engine-import.mjs` writes `d37-config/keys.json` and `REFERENCE.md`
  from the imported wasm (`d37 config dump --json|--md` prints the same). Never hand-edit them.
- Moving ALL games to a new engine = one `engine-import.mjs` into d37/. One game back = one line in its game file.
- A file is `{"format":1, "min_build"?, "max_build"?, "note"?, "values": {key: number}}`; a game file also carries `id`, `title`,
  `scene`, `engine: {channel, build}`, `texts` (ignored by the engine). Reserved value kind: `{"expr": "…"}` (future formulas) —
  accepted by the format, ignored with a warning today.
- The hub shows game / engine build / channel / config hash at the bottom of the pause card; crash reports carry the same.

# Студия — одна дверь (T-176)

Замысел: `M:\d37\d37-core\spec\EDITOR_ONE.md` (одна студия для режимов, 3D-миров и игр-страниц). Здесь — что уже на сайте.

## Шаг S1 «Создать режим и одна дверь» (22.11, флаг `STUDIO_ONE` в `js/core/config.js`; откат — `false`)

- `#/games/studio` (`/play/studio`) — главная `js/games/studio-home.js` (простая разметка, без three.js), стили `css/studio-one.css`.
  1. «🎮 Создать режим» — десять готовых заготовок «Студии 3D». Список `js/games/studio-blanks.js` собирается из самих заготовок
     (`studio3d-modes.js` T + `modes.js` desc; режим и возраст — что заготовка ставит в settings):
     `node scripts/studio-home-test.cjs --write`. Картинки `img/studio/modes/<id>.webp` (480 × 270) — снимки самих заготовок через
     код сайта: `node scripts/studio-home-e2e.cjs shots`.
  2. «✨ Создать» — 3D-мир, шесть шаблонов, «Свой код + ИИ».
  3. «📁 Мои проекты» — игры с сайта (все виды) + черновики браузера (`d37_studio_drafts`) + 3D-миры браузера (`d37_s3_index`).
  4. «🌍 Игры игроков» — по возрасту, как /hub; ошибка — «Не получилось» и «Повторить».
- «Студия 3D»: `#/games/studio3d/new/<заготовка>` — новый мир из заготовки и окно «🎮 Режим игры и ракурс» сразу (неизвестная
  заготовка мир не создаёт); адрес становится `open/<id>`; `#/games/studio3d/open/<id>` — этот мир из браузера. «←» редактора при
  флаге ведёт на главную студии.
- Плитка «Студия» в /hub при флаге ведёт на главную студии.
- Запросы, черновики, метки, адреса — из `studio.js` (`homeCore`, `query` — не прячет отказ).
- Ошибка «Игры игроков» со снимка 37 (21.11): причина — неоднозначная связь с профилями, исправлена в 453c58a; 22.11 запрос каталога
  без входа отвечает (пустой список). С входом не проверено (нет настоящего входа в проверках).

Проверки: `scripts/studio-home-test.cjs` (CI), `scripts/studio-home-e2e.cjs` (CI `--e2e`).

## Шаг S2 «Арена на нашем движке» (22.11, флаг `STUDIO_ARENA` в `js/core/config.js`; откат — `false`)

- Карточка «⚡ Арена на нашем движке» — первая в ряду «Создать режим»: «С нуля» (`#/games/studio/arena/new`) и «Из примера»
  (`…/arena/demo`, пример — файл движка `/d37-preview/modes/trigger_demo.mode.json`). Проект — `…/arena/open/<id>`.
- Редактор `js/games/studio-arena.js` (+ `css/studio-arena.css`). Экран СОБИРАЕТСЯ из `/d37-preview/blocks.json` движка: разделы —
  `file.sections`, заголовки — имена категорий, меню «Добавить» — блоки категории, форма — `params` (число с единицей / min / max /
  step, да-нет, варианты, ссылки — выбор из объектов файла по `ns`, надписи — из `texts`), пределы — `limits`. Правило читается
  «Когда — Если — То» (имена категорий движка). Списков блоков и их русских слов на сайте нет (проверяет studio-arena-test).
- Проверка — функция движка `blocks_check` (wasm канала preview, грузится один раз): причина и предупреждения — под тем полем, на
  которое указывает путь движка; только `textContent`.
- «▶ Проверить» — наш движок в рамке редактора (`engine-host.js` канала preview: `start({scene: 'umode', modeText})`, дальше
  `runMode(text)` — раунд заново за секунду, без перезагрузки). «■ Стоп» — движок закрыт. Режим идёт только у себя (соло).
- Проекты — только в этом браузере (`d37_arena_index`, `d37_arena_<id>`), видны в «Мои проекты» как «⚡ Арена»; «Сохранить в файл» /
  «Открыть из файла» — текстом (вставить или выбрать файл). «Выложить» и «Вдвоём» — «скоро» (нужны сервер и SQL; комната по коду с
  чужим файлом в движке не сделана — E5).
- Движок: ветка `ep36-arena` (команды `game umode file <hex>` / `play mine`, ключ `modekit::USER_FILE_V1`).

Проверки: `scripts/studio-arena-test.cjs` (CI), `scripts/studio-arena-e2e.cjs` (CI `--e2e`).

## Step S3 "Arena to the site" (22.11, flag `STUDIO_SHARE` in `js/core/config.js`; rollback — `false`)
- Reuses the player-games path: `ugc_games`, new kind `arena` (`data` = the mode file, ≤ 64 KB = engine `file_bytes`). Server: community.sql
  PART 19 (`ugc_arena_save`, `ugc_arena_publish`, `ugc_arena_remix`, `ugc_arena_rules`, triggers `ugc_arena_hold` / `ugc_arena_status_guard`);
  old `ugc_status` / `ugc_play` / `ugc_like` / `ugc_report` / `ugc_review` are used as is. Site sees the part by `site_config` row `part19`.
- Editor block «🌍 На сайт»: age select (required to publish), description, «☁️ Сохранить на сайте», «🔗 Ссылка для друзей», «🌍 Выложить за 500 🪙»
  (owner's number; price read from `ugc_arena_rule('price')`). Coins: taken from the author's `coin_wallet` and not credited to anyone
  (`coin_log` source `ugc_publish`); once per arena (`paid_at`, unique index), edits never charge again.
- Play page `#/games/studio/arena/play/<id>`: «⚠ не проверено», age cover, file re-checked by `blocks_check`, «▶ Играть» on our engine,
  ❤️ / 🔗 / ⚠️ report / «🎨 Сделать по мотивам». `#/games/studio/play/<id>` and `/edit/<id>` of an arena redirect to the arena screens.
  `#/games/studio/arena/edit/<id>` pulls an own arena from the site into a browser project (meta `srv`).
- Safeguards (switch rows in `ugc_arena_rules`, value 0): `words` (comm_bad + comm_has_link on title, description, every string of the
  file), `age`, `hide` (3 reports → held, invisible to others, author cannot bring it back; moderator «public» clears it and «не проверено»).
- «Вдвоём» for an arena — still «скоро» (needs the room to carry the file: hash + text within room message limits).
- Tests: `scripts/part19-sql-test.mjs` (CI, PGlite), `scripts/studio-share-e2e.cjs` (CI `--e2e`, fake DB in the test, no real writes).

Дальше: «Вдвоём» для арены (файл в комнату), S1b (облако 3D-миров, один формат, «хранитель» в scene.js), S1c (редактор игр-страниц: отмена, номера строк, общий «Выложить»).

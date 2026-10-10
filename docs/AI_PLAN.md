# План ИИ-помощника «Студии 3D» («✨ ИИ»: построить по описанию, скрипт, исправить, объяснить)

Агент 11.10.2026 разобрался в коде и спроектировал помощника, но по просьбе владельца остановился до того, как начал
писать. Ниже — что он проверил, задуманное устройство и порядок работы.

## Проверено в коде

1. **Расширение студии** (конец `js/games/studio3d.js`).
   - В `STUDIO_API` есть: `ed`, `q`, `slot` (`.s3-ext`), `insert`, `select`, `setSel`, `selected`, `pushHist`,
     `markDirty`, `refresh`, `msg`, `print`, `setBottom`, `showCode`, `playing`.
   - Добавленное после загрузки студии сразу получает `mount`. В режиме игрока расширения не подключаются.
   - Отмена — `pushHist()`. Снимок только объектов: свет и ландшафт не отменяются.
   - Отменить предпросмотр без лишнего «Вернуть»: `ed.SC.fromJSON({objects: JSON.parse(ed.hist.pop())})`, потом
     `api.refresh()`.
   - Включили или выключили ландшафт — ставить `ed.ground.visible = !TR.enabled`.
   - Холмы: `GAME_IMPL.studio3d._test.generateHills(TR, seed)`.
2. **Склейка (`batch.js`)** оборачивает `SC.set` (любой, в том числе «тихий») и слушает add/remove. Полупрозрачный
   «призрак» через `SC.set(o, 'alpha', …)` безопасен, если все правки идут через `SC.set`.
3. **Словарь сцены для проверки плана.**
   - `scene.js`: классы — `DEF`, сохраняемые поля — `SAVE`. В сцене 21 материал, 9 предметов, 4 формы.
   - Лимиты студии (`cleanProp`): размер до 1000, |pos| < 5000, не больше 3000 объектов.
   - `touch`: kill, bounce, speed, coin, finish.
   - NPC: `NPC_PRESETS` (walker, trader, zombie, shy, robot) — внутри `studio3d.js`; внешности и поведение — в
     `D37E.npcs`.
   - Эффекты: `D37E.fx.KINDS`.
   - Свет: time, brightness, ambient, fogEnd, shadows, cycle.
   - Ландшафт: `setEnabled`, `setWater(on, level)`, `sample`, `toJSONSync` / `fromJSON`.
4. **Языки скриптов.** `D37E.langs[id].ai` — правила для ИИ у каждого языка (js, lua, cs, cpp, rust); текст кончается
   на «Задача: ».
   - `L.compile(src, {name, onStep})` → `{wasm, log}` или ошибка с `.log` по-русски («Строка N: ошибка: …»).
   - Rust собирается на сайте только в Chrome / Edge / Яндекс 137+ на компьютере.
5. **Список скриптов.** studio3d в `js/features/games.js`. План: после `studio3d.js` добавить
   `js/games/studio3d-ai-plan.js` и `js/games/studio3d-ai.js`, поднять `GAMES_VER`. Конфликт слияния с другими
   агентами — в этой же строке.
6. **Сервер.**
   - Функций Vercel сейчас 9, `api/ai.js` — десятая. В `vercel.json` (`functions`) — `maxDuration` 60.
   - В `api/_lib/store.js` уже есть `sbRpc` (ключ service role) и `timedFetch`. Проверка входа — `/auth/v1/user`,
     как в `verifyAdmin`.
   - Зависимостей npm нет — к провайдеру ходить обычным `fetch`.
   - Общий код браузера и сервера — UMD-файл (`globalThis.D37AIPlan` и `module.exports`).
7. **Anthropic API** (по данным агента — перед запуском сверить с документацией).
   - Цены за 1 млн токенов:

     | Модель | Ввод | Вывод |
     |---|---|---|
     | `claude-sonnet-5-5` | $2 | $10 |
     | `claude-opus-5-5` | $4 | $20 |
     | `claude-haiku-5-5` | $0,10 | $0,50 |

   - Запрос: POST `https://api.anthropic.com/v1/messages`, заголовки `x-api-key`, `anthropic-version: 2023-06-01`,
     `content-type: application/json`.
   - Глубину рассуждений задаёт `output_config: {effort: 'low'}`. Поле `thinking` у Sonnet 5.5 не передавать:
     `{type:'disabled'}` вернёт 400.
   - Без подстановки начала ответа.
   - Проверять `stop_reason`: `refusal` (категория — в `stop_details`) и `max_tokens`.
   - Коды ошибок: 400, 401, 402, 403, 404, 413, 429, 500, 529.
   - Системный текст кэшировать (`cache_control`).
8. **Монеты и VIP.**
   - `coin_add` клиенту закрыт. Списание: заблокировать строку кошелька (`select … for update`), потом
     `coin_add(uid, -цена, 'ai', ref)`.
   - `vip_tier_of(uid)` → 'gold' / 'silver' / 'bronze' / null. Персонал — `profiles.role` из admin, moderator, helper.
9. **Чем тестировать.**
   - PGlite (0.5.8) — в папке сессии scratchpad\pg; заглушки взять из `test-coins.mjs` (он сначала гоняет
     `coins.sql`) и добавить `create role service_role`.
   - Заглушка THREE для `scene.js` в node — `scripts/physics-test.cjs`, строки 21–61.

## Задуманное устройство

### Формат «d37build v1»

- Верхний уровень: `{d37build:1, title, say, lighting{…}, terrain{on, water, hills}, objects[…]}`. Если ИИ
  отказывается — `{refuse:"…"}`.
- Объекты:
  - part, spawn, light, fx, npc (готовые NPC), prefab;
  - model — со сдвигом `pos`/`yaw` для детей;
  - script — js, lua или cs;
  - item — id из «Набора», только если есть `D37E.toolbox.build`.
- Повторы, чтобы ответы были короче: `repeat{n,step,rot}`, `grid{nx,nz,dx,dz}`, `ring{n,r,face}`.
- Координаты — от якоря (точка, куда смотрит камера, или выделенный объект, на уровне земли). `pos` — центр детали,
  +z — к зрителю. Весь план поворачивается вслед за камерой, с шагом 90°.
- Проверка плана:
  - зажимает размеры, позиции, цвета (hex или названия), материалы, текст;
  - закрывает ссылки, телефоны, почты;
  - скрипт — до 20 000 знаков, за раз — до 300 объектов.
- Постройка — один шаг отмены, сначала «призрак» и кнопки «Принять / Переделать / Отмена».

### Сервер `/api/ai`

- POST `{kind: build|script|fix|explain, prompt, context, lang, code, errors, langDoc}` → `{ok, reason, message,
  plan|code|text, quota}`.
- GET → состояние: есть ли провайдер и сколько осталось у игрока.
- Порядок проверок:
  1. тот же сайт;
  2. провайдер настроен;
  3. размеры;
  4. фильтр запросов;
  5. токен входа;
  6. `ai_take`;
  7. вызов ИИ, 50 с;
  8. разбор и починка JSON.

  Если что-то не вышло после `ai_take` — `ai_refund`.
- Переменные окружения:
  - `ANTHROPIC_API_KEY`;
  - `AI_MODEL` (по умолчанию `claude-sonnet-5-5`);
  - `AI_BASE_URL` + `AI_API_KEY` — любой OpenAI-совместимый провайдер;
  - `AI_PROJECT`, `AI_EFFORT`, `AI_DAILY_LIMIT`.
- Нет провайдера, нет `ai.sql` или `/api` отвечает 404 — клиент сам переходит на «📋 Скопировать задание».

### `ai.sql`

- Таблица `ai_usage`.
- Функции:
  - `ai_price`: постройка — 50 🪙, код — 10 🪙;
  - `ai_free`;
  - `ai_state()` — для клиента;
  - `ai_take` / `ai_refund` — только service role, блокировка по игроку.
- Бесплатно в день:

  | Кто | Построек | Кода |
  |---|---|---|
  | Обычный | 3 | 15 |
  | Bronze | 6 | 30 |
  | Silver | 10 | 50 |
  | Gold | 20 | 100 |
  | Персонал | 30 | 150 |

- Платно — не больше 5 построек и 30 кодов в день.
- Не чаще раза в 3 с.
- Общий дневной потолок на сайт — `AI_DAILY_LIMIT` (по умолчанию 400).

### Примерная цена одного запроса на Sonnet 5.5

| Запрос | Цена |
|---|---|
| Постройка | ≈ $0,045 |
| Скрипт | ≈ $0,017 |
| Объяснение | ≈ $0,009 |

Haiku — примерно в 20 раз дешевле, Opus — примерно вдвое дороже.

## Порядок работы

Коммит после каждого шага.

1. `js/games/studio3d-ai-plan.js`: схема, проверка, план → сцена, вытаскивание JSON и кода из ответа, фильтр, тексты
   запросов.
2. `js/games/studio3d-ai.js` + стили `s3-ai-` в `css/premium.css` + регистрация в `games.js`.
3. `api/ai.js` + запись в `vercel.json`.
4. `ai.sql` + тест PGlite.
5. `scripts/ai-test.cjs`.
6. `docs/AI_SETUP.md` — для владельца: какой провайдер, где взять ключ, куда вставить в Vercel, сколько стоит.
7. Проверить в браузере на своём порту (`scripts/serve.py`):
   - замок и обби по описанию;
   - скрипт двери на каждом языке;
   - ▶ Играть.

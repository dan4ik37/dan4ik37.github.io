<!-- Moved verbatim from CLAUDE.md on 2026-10-28 (CLAUDE.md is now a short English index). Russian, as written then. When you change this area, rewrite the part you touch in short English. -->

## 🖼 Фоторедактор /photo (T-017, агент 22.10.2026; выбор основы и устройство — docs/PHOTO.md)
- Страница для поиска /tools/photo (api/_lib/routes/photo.js) → «Открыть редактор» → раздел /photo (PAGES.photo, canonical → /tools/photo;
  /photo/<номер материала> — сразу открыть картинку). Загрузчик js/apps/apps.js (D37Apps, VER — поднять при правке js/apps/photo/*,
  css/photo.css; версии fabric/ORT/модели — только там). Основа — fabric.js 7.4.0 (MIT, jsDelivr; sw.js кэширует). miniPaint НЕ брать:
  в его bundle.js — AlertifyJS (GPL-3.0). PhotoCraft — только с разрешения владельца (≈11,9 МБ в репозиторий, на телефоне не годится).
- Всё, что меняет работу, — команда «d37 v1» (js/core/tools.js, D37Tools.run('photo', …)): кнопки и ИИ одним путём, у каждой — шаг
  «Отменить» (сколько шагов записано на самом деле — ctx.steps; ничего не поменялось — 0; набранный текст новой надписи — тем же
  шагом «Надпись»). Новая кнопка = команда в SCHEMAS (photo-cmds.js) + RUN (photo-core.js) + пример в photo-test.cjs. Номера слоёв не
  меняются (размер, объединить). Коррекции — на экране копия ≤1536 (телефон) / ≤4096 (ПК) с WebGL-фильтрами fabric, при сохранении —
  те же фильтры в полный размер в потоке (photo-worker.js importScripts fabric). Кисть: отмена — куски 256×256 холстами (без чтения пикселей).
- «Мои материалы» — js/core/assets.js (D37Assets, IndexedDB «d37-assets», только этот браузер). «📤 Сохранить» → скачать / материалы /
  «Студия 3D» (плоскость с картинкой в «🧩 Модели» через D37E.models) / проект со слоями .d37photo (формат и проверка чужого файла —
  photo-cmds.js packProject/readProject). Ушёл из /photo с несохранённым — черновик-проект (один, закреплён; d37_pe_draft), на старте
  «↩ Продолжить»; вернулся, пока пишется, — тот же редактор (apps.js away / photo-ui leave·resume); не записалось — редактор ждёт скрытым.
  ИИ — js/core/ai-bridge.js (D37AI: задание для ИИ без ключей,
  ответ JSON выполняется по шагам) и «🪄 Убрать фон» (U²-Netp Apache-2.0 + ONNX Runtime Web MIT, ~8 МБ при первом нажатии).
- Реклама: только loading при загрузке редактора и столбик rail справа на ПК ≥ 1400 px, не поверх холста. 0+.
- Тесты: node scripts/photo-test.cjs (166), node scripts/photo-e2e.cjs smoke|ui|proj|ai|load|big|idle|leak|soak|shot (Chrome, профиль
  телефона; ui — настоящими касаниями: кисть, щипок, надпись, обрезка 9:16, слои, «↶»; proj — проект и черновик).
- Исправлено попутно: js/features/fx.js placeIndicator вызывал сам себя каждый кадр на всех страницах (classList.add/remove без изменений
  пишет атрибут → MutationObserver) — теперь toggle(…, вкл).

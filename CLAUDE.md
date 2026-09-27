# dan4ik37 — сайт стримера

Статический SPA без сборки: `index.html` (разметка + большой inline `<style>`) + `css/premium.css`
(визуальный слой поверх) + `js/**` (обычные `<script>`, глобальные функции, без модулей).
Бэкенд — Supabase (таблицы/RPC, миграции в `*.sql` в корне) и Vercel-функции в `api/`.

## Деплой
- `git push` в `main` → Vercel сам выкатывает `https://dan4ik37.vercel.app`. Zip-архивы больше не нужны.
- Проверить, что выкатилось: открыть нужный файл по прямой ссылке (например `/css/premium.css`) и найти свежую правку.
- SQL из `*.sql` сам не применяется — его запускают руками в Supabase SQL Editor. Новые миграции — отдельными
  файлами (как `referrals.sql`, `streaks-achievements.sql`), идемпотентными (`create or replace`, `if not exists`).

## Локальный запуск
`python -m http.server 5500` в корне → `http://localhost:5500/#/home`.
`/api/*` локально отдают 404 — это нормально (это Vercel-функции).

## Как устроено
- Роутер: `js/ui/router.js`, объект `PAGES` — какие блоки (`id`) показывать на каждом `#/route`.
  Новый блок на странице = добавить его `id` в `PAGES`.
- Режимы производительности: `body.high` / `body.low` (`js/features/performance-mode.js`, `fx.js`).
  Всё, что анимируется непрерывно, — только под `body.high`. Правила `prefers-reduced-motion` написаны под
  `body:not(.high)`, чтобы явный выбор «Мощное» побеждал системную настройку.
  Если «на ПК анимации стоят, а на телефоне ок» — начинать с этого.
- Главная: герой с новым видео (`youtube.js` → `renderFeatured`), Twitch-плашка (`twitch.js`, статус эфира через
  decapi.me), лента с сортировкой (`setVidSort`), блок «Сообщество» (`#community`).
- YouTube API: ключ в `js/core/config.js`, кэш 15 мин в localStorage (`dan4ik37_cache_v2`) — при свежем кэше
  запросов к API нет. Квота 10 000/сутки; `search` стоит 100 единиц — не использовать его на каждом заходе.
- Вошёл ли пользователь: глобальная `currentUser` (`chat.js`), класс `body.is-authed`.
- Акцентные цвета — `var(--accent)` / `var(--accent2)` (их перекрашивает VIP-тема), токены — в начале `premium.css`.

## Не путать
В корне репозитория лежит ещё отдельный Electron-проект «VTuber VRM Player» (`main.js`, `preload.js`,
`renderer.js`, корневой `config.js`, `package.json`, `assets/`, `tools/`, `README.md`) — к сайту не относится.

## Известные хвосты
- AdSense: `adsbygoogle.push()` вызывается сразу при загрузке для всех слотов, включая скрытые роутером →
  ошибка «No slot size for availableWidth=0», реклама в этих слотах не показывается.
- Профиль: приглушить «Панель администратора», скрытие почты (механизм уже есть в `profile.js`: `maskEmail`,
  `profileEmailVisible`), настройки приватности — не начаты.

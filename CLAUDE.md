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
  decapi.me), ряд Shorts, лента с сортировкой (`setVidSort`), блок «Сообщество» (`#community`) с топом недели по XP.
- Данные роликов грузит `ensureYT()` один раз; по готовности зовётся `onVideosLoaded()` (shorts.js).
- Разделы: `#/shorts` (shorts.js), `#/ideas` (ideas.js + `ideas.sql`), XP/уровни (xp.js + `xp.sql`).
  Пока SQL-файл не выполнен, раздел прячется (`body.no-ideas`, `body.no-xp`), без ошибок.
- Серверные страницы: `/v/<id>` → `api/video.js`, `/sitemap.xml` → `api/sitemap.js` (rewrites в `vercel.json`,
  общий код — `api/_lib/yt.js`). Локально проверять вызовом handler'а из node.
- AdSense: ID блоков — `AD_SLOTS` в `config.js`, загрузка — `js/features/ads.js` (только видимые блоки).
- Событие `d37:auth` — после входа (роль уже загружена) и выхода.
- Уведомления 🔔: `notifications.sql` (создают только триггеры, `notify()`), `js/features/notifications.js`
  (Realtime по `user_id`, опрос раз в 90 с, счётчик в заголовке вкладки). Скрыты, пока SQL не выполнен.
- Защита опросов/реакций: `polls-reactions-secure.sql` (user_id; до запуска — фолбэк на старое поведение).
- `body[data-route]` — текущий раздел (для CSS).
- YouTube API: ключ в `js/core/config.js`, кэш 15 мин в localStorage (`dan4ik37_cache_v2`) — при свежем кэше
  запросов к API нет. Квота 10 000/сутки; `search` стоит 100 единиц — не использовать его на каждом заходе.
- Вошёл ли пользователь: глобальная `currentUser` (`chat.js`), класс `body.is-authed`.
- Акцентные цвета — `var(--accent)` / `var(--accent2)` (их перекрашивает VIP-тема), токены — в начале `premium.css`.

## Базовые таблицы (созданы старыми скриптами, которых нет в репозитории)
`messages` (id bigserial, nick, text, color, role, user_id → auth.users, deleted, created_at), `profiles` (id, nick, role),
`banned_nicks`, `site_config` (key/value, пишет только admin), `poll_votes` (poll_id, option, nick),
`message_reactions` (message_id, emoji, nick; unique по тройке), `custom_emoji` + бакет `emoji`.
Изначально insert в messages/poll_votes/message_reactions открыт всем (`with check (true)`); роль/ник в messages потом
закрыты триггером `messages_enforce_status` (vip-balance.sql), роль в profiles — `prevent_self_role_escalation`.
Голоса в опросах и реакции закрыты в polls-reactions-secure.sql.

## Не путать
В корне репозитория лежит ещё отдельный Electron-проект «VTuber VRM Player» (`main.js`, `preload.js`,
`renderer.js`, корневой `config.js`, `package.json`, `assets/`, `tools/`, `README.md`) — к сайту не относится.

## Следующая задача: настоящие push-уведомления (владелец согласовал, делать в новой сессии)
Сейчас кнопка «🔔 Подписаться на стримы» (`js/features/push-pwa.js` → `togglePush`) — пустышка: только
`Notification.requestPermission()` и одно локальное уведомление, подписки и сервера нет — подписчики ничего не получают.
Нужно: уведомления о **новом видео** и **начале стрима** даже при закрытом сайте.
- Клиент: `pushManager.subscribe` с VAPID public key → сохранить подписку в Supabase (таблица, напр. `push_subscriptions`:
  endpoint unique, keys p256dh/auth, user_id nullable, какие темы — видео/стримы). Отписка = удаление строки.
- `sw.js`: обработчики `push` (показать уведомление) и `notificationclick` (открыть /v/<id> или #/home).
- Сервер: `api/push-check.js` — проверяет новые видео (`api/_lib/yt.js` → `getUploads`) и эфир Twitch
  (decapi.me, как в `js/features/twitch.js`), помнит «что уже разослано» в Supabase (`site_config` или своя таблица),
  шлёт Web Push всем подписчикам; мёртвые подписки (404/410) удалять.
- Web Push без npm-зависимостей: корневой `package.json` принадлежит Electron-проекту, трогать его нельзя →
  VAPID (ES256 JWT) и шифрование aes128gcm (RFC 8291) на `node:crypto`. Либо обсудить с владельцем отдельный package.json для api.
- Доступ к БД с сервера — `api/_lib/store.js` (env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` уже заданы).
  Защита вызова — как в `api/vip-sync.js`: `Authorization: Bearer ${CRON_SECRET}`.
- Новые env в Vercel: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:). Сгенерировать ключи и дать
  владельцу пошагово, куда вставить.
- Расписание: Vercel Hobby cron — только раз в сутки. Для стримов нужен внешний бесплатный будильник (cron-job.org,
  каждые 5–10 мин, с заголовком Authorization) — расписать владельцу по шагам. Суточный cron Vercel — как запасной.
- SQL — отдельный идемпотентный файл (напр. `push.sql`), RLS: вставлять/удалять свою подписку может любой посетитель
  (гости тоже), читать все подписки — только сервер (service role).

## Известные хвосты
- AdSense: сайт в кабинете зарегистрирован как dan4ik37.github.io и отклонён («бесполезный контент»); главный адрес —
  dan4ik37.vercel.app (github.io перенаправляет туда). Нужны ID блоков в `AD_SLOTS`.
- Настройки приватности профиля — не начаты (нужно уточнить объём у владельца).
- Скриншоты во встроенном браузере при прокрутке бывают чёрными, а rAF/IntersectionObserver стоят, пока панель
  не отрисовывается, — это особенность среды, не сайта.

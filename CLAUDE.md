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

## Push-уведомления (новое видео / начало стрима, даже при закрытом сайте)
- Клиент: `js/features/push-pwa.js` (`togglePush`, `syncPush`) — `pushManager.subscribe` с ключом из
  `GET /api/push-check?pubkey=1`, сохранение через RPC `push_subscribe` / `push_unsubscribe` (обычный fetch, без SDK).
  После подписки `POST /api/push-check?test=1 {endpoint}` шлёт приветствие (только подписке моложе 10 мин).
- `sw.js`: обработчики `push` (JSON `{title, body, url, image, tag}`) и `notificationclick`.
- Сервер: `api/push-check.js` (проверка + рассылка, только с `Bearer ${CRON_SECRET}`), `api/_lib/webpush.js`
  (VAPID ES256 + aes128gcm на `node:crypto`, без npm). Что уже разослано — таблица `push_state`.
  Первый запуск только запоминает состояние; повтор эфира в течение 3 ч не рассылается; 404/410 → подписка удаляется.
- SQL: `push.sql` (таблицу подписок читает только service role).
- Env в Vercel: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (+ уже заданные SUPABASE_*, CRON_SECRET).
- Расписание: cron-job.org каждые 5 мин → `https://dan4ik37.vercel.app/api/push-check` с заголовком
  `Authorization: Bearer <CRON_SECRET>`; Vercel cron раз в сутки (vercel.json) — запасной.
- Встроенный браузер не регистрирует service worker («unknown error when fetching the script», даже для старого sw.js) —
  push проверять на проде в обычном Chrome. Серверную часть — вызовом handler'а из node с подменённым fetch.

## Приватность профиля (privacy.sql)
- Настройки — блок «🔒 Приватность» в «Настройках аккаунта» (`renderPrivacySettings` / `savePrivacy` в profile.js):
  кто видит профиль (все / друзья / только я), заявки в друзья (от всех / ни от кого), невидимка (не пишет визиты
  в «Гости профиля» и стирает старые), скрыть сумму донатов (в профиле и в публичном топе — там «Аноним», `api/donations.js`).
- Прячет база: прямое чтение `profiles` открыто только для `id, nick, role, avatar_url, is_vip, vip_until, theme_accent`,
  всё остальное — через представление `profiles_public`. **Читать профили в js — через `sbProfiles()` (chat.js)**, не
  `sbClient.from('profiles')` (запись — по-прежнему в `profiles`). Новая колонка profiles клиенту не видна, пока её
  не добавили в `profiles_public`. Встроенные select профилей в других таблицах — только публичные колонки.
- Персонал тоже соблюдает приватность: на скрытом профиле модератору видны только служебные данные (`staff_view`:
  дата регистрации, роль, VIP, остаток до месяца VIP); админ всегда видит сумму донатов и логин DA.
- `donate_login`, `vip_pending_rub`, `referred_by` раньше читались всеми — теперь только сам человек / админ (персонал).
- SQL проверялся на PGlite с ролями anon/authenticated и заглушкой `auth.uid()` — так же можно проверять новые правки.

## Известные хвосты
- AdSense: сайт в кабинете зарегистрирован как dan4ik37.github.io и отклонён («бесполезный контент»); главный адрес —
  dan4ik37.vercel.app (github.io перенаправляет туда). Нужны ID блоков в `AD_SLOTS`.
- «Тиммейты» (#/lfg) не работают, пока не выполнен `lfg-and-mini-profile.sql` (нет таблицы `lfg_posts`).
- Скриншоты во встроенном браузере при прокрутке бывают чёрными, а rAF/IntersectionObserver стоят, пока панель
  не отрисовывается, — это особенность среды, не сайта.

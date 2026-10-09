# dan4ik37 — сайт стримера

Статический SPA без сборки: `index.html` (разметка + большой inline `<style>`) + `css/premium.css`
(визуальный слой поверх) + `js/**` (обычные `<script>`, глобальные функции, без модулей).
Бэкенд — Supabase (таблицы/RPC, миграции в `*.sql` в корне) и Vercel-функции в `api/`.

## Цель и как работать с владельцем
- **Цель сайта — зарабатывать**: трафик → реклама (AdSense), VIP за донаты, донаты. Любую новую фичу оценивать так:
  приводит ли она людей (SEO, шаринг), удерживает ли (возвращаться каждый день) или приносит деньги напрямую.
- Владелец не программист, пишет по-русски. Объяснять по шагам, одна команда — один блок. Сам SQL не пишет.
- **SQL владелец применяет пачкой в конце** — не просить запускать после каждой правки. В конце работы дать
  один список «что выполнить и в каком порядке». После «всё/сделал» — проверить применение с сервера (см. ниже).
- Коммитить и пушить в `main` можно без отдельного вопроса — так договорились, это и есть выкладка.

## Ожидает запуска владельцем (обновлять этот список!)
Сейчас ничего. vip-claims.sql применён 09.10.2026 (проверено: claim_donation гостю → 42501, admin_* → «Только для админа»).
secrets.sql, games.sql, progression.sql применены (03.10.2026, проверено с сервера).

## Грабли этой истории — не наступать повторно
- **Скрипт в SQL Editor выполняется целиком или откатывается целиком.** Одна ошибка = ничего не применилось.
  Перед тем как опираться на колонку/функцию, проверить её на живой базе через REST с publishable-ключом
  (`/rest/v1/<таблица>?select=<колонка>&limit=0` → 400 «does not exist»; `/rpc/<функция>` → PGRST202 = нет).
  На базе НЕ все старые скрипты применены целиком (так было с новой частью server-hardening.sql, lfg-and-mini-profile.sql).
  Новый SQL сам добавляет нужные колонки `add column if not exists`, а не надеется на прошлые файлы.
- **Тест SQL на PGlite** (`@electric-sql/pglite` во временной папке, роли anon/authenticated, заглушка `auth.uid()`
  через `current_setting('request.jwt.claim.sub')`). Заглушки таблиц — строго как на живой базе, иначе тест врёт
  (тест прошёл, а на базе не было `vip_donation_log.donated_at`).
- «Всё сделал» от владельца ≠ применилось: всегда проверять с сервера и говорить честно, что не применилось.
- Python со строками по-русски — только `python -X utf8 script.py`; сложные правки писать файлом-скриптом через
  Write, а не heredoc в bash (bash-heredoc с кавычками/`$` в этой среде падает с «unexpected EOF»).
- `el.style.display = ''` стирает инлайновый `display:grid` из разметки — возвращать явное значение ('grid').
- Горячие клавиши сайта (`hotkeys.js`) перехватывают стрелки/цифры — у всего, что слушает клавиатуру, учитывать.
- Онлайн-комнаты: служебное поле отправителя `_by` (у данных свои `from`); первый presence-sync сообщать;
  новый человек в комнате → хозяин начинает новую партию; «победа» при уходе соперника на 1–2 ходу — без XP.
- Встроенный браузер: service worker не работает, rAF/анимации стоят, пока панель не видна (игровой цикл проверять
  в node с подменённым requestAnimationFrame), старые js берутся из кэша — `fetch(url, {cache:'reload'})` + reload.
- **Vercel Hobby: не больше 12 серверных функций** (каждый файл `api/*.js` = функция; `api/_lib/` — не функции). На 13-й
  выкладка падает молча — сайт остаётся старым. Новые серверные страницы — в `api/_lib/routes/` + строка в `api/pages.js`
  + rewrite `?page=…`. Статус выкладки: `curl https://api.github.com/repos/dan4ik37/dan4ik37.github.io/commits/<sha>/statuses`.
- Если проверка действий (auto mode) не отвечает несколько раз подряд — остановиться и сказать владельцу
  переключить режим разрешений; после 10 сбоев подряд ход обрывается сам.

## Идеи на следующую сессию (с прицелом на деньги)
- **Реклама**: владельцу зарегистрироваться в РСЯ (partner.yandex.ru), вписать номера блоков в `ADS_IDS`.
- **AdSense**: блоки созданы (02.10.2026), номера вписаны. Владельцу осталось: подключить в кабинете сайт
  dan4ik37.vercel.app (github.io был отклонён) и платёжные данные.

## Деплой
- Поиск: сайт подтверждён в Google Search Console (метатег google-site-verification в index.html) и Яндекс Вебмастере
  (файл yandex_4bbc1f658d62c01a.html в корне) 02.10.2026, sitemap.xml отправлен в оба. **Не удалять** ни тег, ни файл.
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
- Серверные страницы: `/v/<id>` → `api/video.js`, `/games` и `/games/<id>` → `api/game.js` (SEO-страницы игр: правила,
  советы, FAQ + JSON-LD; тексты — `api/_lib/games-seo.js`, кнопка «Играть» ведёт в SPA `/#/games/<id>`),
  `/videos` → `api/pages.js?page=videos` (`api/_lib/routes/videos.js`) (архив всех роликов, 240 на страницу, `?p=N`), `/sitemap.xml` → `api/sitemap.js` (rewrites в
  `vercel.json`). Весь архив (~6000 роликов) — `getUploads(ALL_UPLOADS)`: СНИМОК `api/_lib/uploads-snapshot.js` + только новые
  ролики сверху через API (было ~120 запросов и 25–35 с на холодную). Снимок пересобрать: `node scripts/snapshot-uploads.mjs`
  (если на канале удалили/скрыли много роликов или вышло больше 200 новых). Страница ролика — `getUploads(200)` (квота YouTube API!). Похожие ролики — `relatedVideos()` в yt.js. Аудит и план — `docs/SITE_AUDIT.md`.
  Темы (игры канала): `/topics`, `/topic/<slug>` → `api/topic.js`; список и правила подбора по названию — `api/_lib/topics.js`
  (тема ≥ 30 роликов; новая игра на канале → новая запись). Страница ролика показывает «Ещё по теме».
- «🎲 Удиви меня» — `js/core/surprise.js` (`d37Surprise(btn)`, и в SPA, и на серверных страницах): случайный /v/<id> из всего
  архива по `/api/ids` (api/ids.js, кэш CDN 6 ч). Кнопки: «Сегодня» на главной, /videos, /v/<id>, /topic/…, поиск Ctrl+K.
- Страница VIP для всех: `/vip` → `api/_lib/routes/vip.js` — таблица уровней, как купить, VIP за уровень, FAQ. Цифры — из кода
  (VIP_TIERS, can_be_invisible, vip-secure.sql: 100₽/мес, остаток копится). Поменялись условия VIP — поправить и там.
- Медиакит для рекламодателей: `/reklama` → `api/_lib/routes/reklama.js` — живые цифры YouTube (`getChannelStats`,
  `getVideoStats` в yt.js), игры, форматы, контакты; цен нет. Раздел #/ads ведёт туда. Канал не выкладывал ролики с 10.04.2026 —
  поэтому там «роликов за год», а не «за месяц».
- «История канала»: `/history` → `api/history.js` — по годам из настоящих данных (число роликов, топ игр года по темам,
  первое видео года), ничего не выдумывать.
- «Генератор ников для игр»: `/tools/nick` → `api/tool-nick.js` (SEO: «генератор ников», «ник для роблокс»), словари и
  генерация — `api/_lib/nicks.js` (тот же код уходит в браузер через toString(); примеры в HTML — с зерном, не меняются).
- Поиск по сайту: `js/ui/hotkeys.js` (Ctrl+K, «/», кнопка 🔍 в шапке) — разделы + `SITE_PAGES` (серверные страницы: /vip,
  /videos, /tools/nick…), игры (GAMES), видео (allVids → /v/<id>) и весь архив по `/api/ids?t=1` (грузится при первом поиске). Общий HTML-шаблон и стили — `api/_lib/page.js`,
  YouTube — `api/_lib/yt.js`. Локально проверять вызовом handler'а из node (копия api/ во временной папке с
  `package.json` `{"type":"module"}`). Новая игра → добавить и в `GAME_PAGES`.
- Ролики про кейсы/промокоды на депозит (GGDROP, CaseBattle…, ~490 из 6000): `isGambling()` в yt.js → `/v/<id>` рендерится
  с `noAds` (без скрипта AdSense и без места рекламы) — AdSense запрещает рекламу рядом с азартными играми.
- Реклама: номера блоков — `window.ADS_IDS` в `js/core/ads-core.js` (Яндекс РСЯ `R-A-…` и/или Google; Яндекс главнее —
  Google в РФ рекламу не показывает). Один файл и для SPA, и для серверных страниц (`<div data-ad="ключ">` + `D37Ads.fillAll()`).
  Места: game_over (под игрой после партии, не чаще 90 с), games_hub, seo_game, video_page, home_mid, floor (полоска на
  телефоне, не поверх игры). Пустой номер = места не видно. Старые AdSense-блоки — `AD_SLOTS` в config.js + `js/features/ads.js`.
- Чат (`#/chat`, chat.js): на телефоне окно от шапки до нижнего меню (premium.css, `body[data-route="chat"]`); кнопка ⛶ —
  `toggleChatFull()` (body.chat-full, Wake Lock — экран не гаснет; у #chat свой слой z-index:1 — в полноэкранном его поднимаем).
  Вкладка Twitch грузится по `dataset.loaded`, НЕ по `iframe.src` (у пустого iframe src = адрес страницы — так Twitch не грузился годами).
  Ярлыки на иконке установленного сайта — `shortcuts` в manifest.json.
- VIP на виду: «✨ VIP» в шапке (`.nav-vip`, перед ним fx.js вставляет «Ещё ▾»), плашка «VIP за донат» на #/donate
  (`renderDonateVipHint` в profile.js: свой логин для доната + «Скопировать»), `#/profile/vip` — свой профиль сразу на
  блоках «Логин для доната»/«Хочу купить VIP» (туда ведёт «Получить VIP» со страницы /vip). `openGlobalAuth('register')` —
  сразу вкладка регистрации. У серверных страниц на телефоне — меню ☰ (`details.mmenu` в page.js).
- Аватар: один ободок. Есть рамка за уровень (`lv-frame-*`) — цвет роли/VIP только мягким свечением, без своего кольца.
- Телефон, открыта игра: `body.game-on` (games.js) — нижнее меню спрятано; «5 букв» подгоняет поле по высоте экрана.
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

## Прогрессия (progression.sql): уровни, ачивки, награды
- Цифры в двух местах: сервер (`friend_limit`, `check_level_rewards`, `achievement_xp`, `my_achievements`) и клиент
  (`LEVEL_REWARDS` в xp.js, `ACHIEVEMENT_DEFS` в achievements.js). Меняешь одно — меняй другое.
- Уровень 5: рамка аватара + заявки в друзья (как ограниченный аккаунт Steam: иначе 5 рефералов или донат; персонал
  всегда). Лимит друзей 15 → +5 каждые 5 уровней с 15-го до 35 (30 ур.); VIP 50/70/100; персонал без лимита.
  Проверка — RLS на `friendships` (insert и accept). Уровень 10: титул (`user_titles`, RPC `set_title`), титул роли/VIP
  показывается только пока роль/VIP есть (`nick_extras`). 30/50/100: Bronze 1 мес / Silver 3 мес / Gold 1 год
  (`vip_grants`, прибавляется после текущего VIP). Уведомления о порогах — `level_progress` + `notify()`.
- VIP-уровень теперь = max(донатный, за уровень): `vip_tier_of()` (её зовут has_perks, закреп, messages.vip_tier);
  `profiles_public` отдаёт эффективные `is_vip`/`vip_until` и `vip_tier` — клиент `getVipTier()` берёт `vip_tier`.
  VIP за уровень нельзя писать в profiles: триггер `protect_profile_columns` откатывает is_vip в клиентской сессии.
- XP: ачивки — разово (`claim_achievements()` при входе и на своём профиле, source `ach`), донаты — 1 XP/₽ до 1000
  (триггер на `vip_donation_log.matched`, source `donation`). Невидимка — с Silver VIP (`can_be_invisible`).
- Рамки (лесенка): 5 неон · 15 золото · 30 радуга · 50 пламя · 100 бриллиант — `FRAME_LEVELS`/`avatarFrameClass` в xp.js,
  стили `.lv-frame-*` в premium.css (только CSS, без SQL), анимация — только в `body.high`. Подписи — LEVEL_REWARDS.

## Игры (#/games, games.sql)
- Витрина и общее API — `js/features/games.js` (`GAMES`, `gamesApi(id).report(key, win, score, localBest)`).
  Сами игры — `js/games/*.js`, грузятся лениво при открытии; регистрируются в `GAME_IMPL[id] = { mount, unmount }`.
  Новая игра = запись в `GAMES` + файл + ключ в `game_score_cap`/`game_win_xp` (games.sql) + подпись в `gameBestLabel`.
- «Города»: словарь `js/games/cities-data.js` (города России — пакет russia-cities-data, ISC, уведомление в файле;
  мир — свой список). Пересобрать: скрипт из сессии не сохранён — формат строки `название|страна|население|шир|долг`.
- Сервер: `game_result()` (ключ игры из белого списка, очки ≤ потолка, не чаще раза в 5 с, XP за победу — до 15 в день,
  source `game`), `game_top()`. Ачивки игр — в `my_achievements` (progression.sql) по `game_stats`.
- «Города» онлайн: `#/games/cities/<код>` — Supabase Realtime (канал `cities-duel-<код>`, broadcast + presence,
  без таблиц). Хозяин — кто раньше в комнате, шлёт start; ходы проверяет каждая сторона. Победа короче 3 своих
  городов не отправляется (защита от накрутки двумя вкладками). Проверять — двумя вкладками на localhost.
- Онлайн для остальных игр — общий модуль `js/games/room.js` (`GameRoom.join/lobby/newCode`), сейчас: шашки,
  крестики-нолики, морской бой (`sea.js`: каждый хранит свой флот, отвечает на выстрел `res` hit/miss/sunk;
  бот проверяется в node через `GAME_IMPL.sea._test`). Служебное поле отправителя в сообщениях — `_by` (не `from`: у ходов шашек from — клетка).
  Шашки: правила проверены на позициях в node через `GAME_IMPL.checkers._test`.
- «⚔️ Соревнование» для одиночных игр (Угадай видео, 2048, Лови донаты, Реакция, Змейка, Найди пару) — `js/games/versus.js`:
  хозяин шлёт seed, у обоих одинаковый генератор (`Versus.rng`), счёт соперника вживую, результат — `<игра>_duel`
  (только если оба доиграли). Игра даёт `run(stage, rng, hooks)` и зовёт `hooks.progress/done`; случайность — только
  через rng, позиции/скорости — в долях поля. Если в комнату пришёл другой человек (или соперник обновил страницу),
  хозяин начинает новую партию — это же правило в шашках, крестиках-ноликах и «Городах».
- Рекорды: «За неделю» (`game_top_week`, по game_log) / «За всё время» (`game_top`); «Чемпионы дуэлей» (`duel_top`) —
  победы в `%_duel` и `%_online` во всех играх.
- Задание дня: `daily_quest_code()` (12 заданий по кругу от даты по МСК), прогресс — по `game_log` (пишет game_result,
  хранится 14 дней), награда 50 XP — `claim_daily_quest()` (source `daily`, ref = дата). Тексты — `DAILY_QUESTS` в games.js.
- «Поддержать стрим / Позвать друга» — плашка `gamesSupport()` в games.js после победы или рекорда (не чаще раза
  в 10 мин, максимум 3 за визит); ссылка «позвать» ведёт на SEO-страницу `/games/<id>`.
- «📣 Вызов» (кнопка в шапке игры, `gamesChallenge()`) — ссылка `/games/<id>?s=<рекорд>&n=<ник>`: api/game.js
  показывает «Ник набрал N — побьёшь?» в заголовке/превью (canonical — чистый /games/<id>). Подписи результата на
  сервере — `scoreLabel()` в games-seo.js (как `gameBestLabel` в games.js). Картинки превью — `img/games/<id>.png`,
  рисует `img/games/_make-cards.py` (Pillow + шрифты Windows; новая игра → добавить строку и перезапустить).
- «5 букв» (`js/games/words.js`): слово дня (одно на всех, день №1 = 03.10.2026, смена в полночь МСК), свободная
  игра, соревнование. Словари — `js/games/words-data.js`, собирает `scripts/make-words.py` из npm `dictionary-ru`
  (BSD-3, уведомление в файле данных). Загадываемые слова — свой список в скрипте. Ключи сервера: words / words_free / words_duel.
  Логика подсветки — `GAME_IMPL.words._test.evaluate` (проверять в node, повторы букв!).
  «💡 Подсказка» — одна буква на слово только для VIP/персонала (`hasPerks`), остальным — как получить VIP (донат / 30 ур.);
  в «Поделиться» помечается 💡. Подсказка дня сохраняется в d37_words_day сразу (иначе перезагрузкой берут вторую).
- «Сегодня на сайте» на главной (блок `#today`, `renderToday()` в games.js): слово дня, игры, архив видео. Пункт «🎮 Игры»
  в нижнем меню телефона с красной точкой, пока слово дня не сыграно (`gamesDailyDot()`, по localStorage d37_words_day).
- Охота за секретами: `js/features/secrets.js` (+ `secrets.sql`). 7 знаков ✦ (`data-secret="код"`): avatar (5 кликов по
  аватарке, easter-egg.js), footer, games (под рекордами), archive (последняя страница /videos), horror (/topic/horror),
  levels («Что даёт уровень»), words (итог слова дня). Находки — localStorage, при входе уходят в secret_found().
  Все 7 → радужный ник на 30 дней (`.nick-rainbow`, в чате `.cu-nick`, в профиле #profileNick) + 100 XP. Панель — #secretHunt в «Играх».
- «Задонатил, а VIP не пришёл?»: `js/features/donation-claims.js` + `vip-claims.sql`. Форма — в блоке «Логин для доната» своего
  профиля; авто-привязка несопоставленного доната, если имя в DonationAlerts ≤ 2 опечатки от логина/ника заявителя (`d37_lev`),
  иначе — заявка админу (уведомление; список и кнопки — в «Панели администратора»). Похожих донатов несколько → «Выдал вручную».
  Лимит 5 заявок/сутки, донат привязывается один раз. Тест — PGlite (все сценарии, включая одобрение админом).
- Профиль: настройки аккаунта — внизу; «О себе» на чужом профиле без текста скрыт; ачивки — полученные + 8 закрытых,
  остальные по кнопке; карточка «🎮 Игры на сайте» (`renderProfileGameStats` в games.js, по game_stats).
- Пока открыта игра, горячие клавиши страниц (`hotkeys.js`) отключены — стрелки/цифры принадлежат игре.

## Известные хвосты
- AdSense: сайт в кабинете зарегистрирован как dan4ik37.github.io и отклонён («бесполезный контент»); главный адрес —
  dan4ik37.vercel.app (github.io перенаправляет туда). Номера блоков вписаны; Google в РФ рекламу не показывает —
  для российских зрителей потом подключить РСЯ (`ADS_IDS.yandex`).
- Скриншоты во встроенном браузере при прокрутке бывают чёрными, а rAF/IntersectionObserver стоят, пока панель
  не отрисовывается, — это особенность среды, не сайта.

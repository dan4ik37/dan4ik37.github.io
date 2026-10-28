<!-- Moved verbatim from CLAUDE.md on 2026-10-28 (CLAUDE.md is now a short English index). Russian, as written then. When you change this area, rewrite the part you touch in short English. -->

## Деплой
- Поиск: сайт подтверждён в Google Search Console (метатег google-site-verification в index.html) и Яндекс Вебмастере
  (файл yandex_4bbc1f658d62c01a.html в корне) 02.10.2026, sitemap.xml отправлен в оба. **Не удалять** ни тег, ни файл.
- `git push` в `main` → Vercel сам выкатывает `https://dan4ik37.vercel.app`. Zip-архивы больше не нужны.
- Проверить, что выкатилось: открыть нужный файл по прямой ссылке (например `/css/premium.css`) и найти свежую правку.
- SQL из `*.sql` сам не применяется — его запускают руками в Supabase SQL Editor. Новые миграции — отдельными
  файлами (как `referrals.sql`, `streaks-achievements.sql`), идемпотентными (`create or replace`, `if not exists`).
- **Мониторинг, автопроверки, копии (T-016, подробно — docs/OPS.md, для владельца — docs/BACKUPS.md).** Ошибки у посетителей:
  исходник ОДИН — `api/_lib/errlog.js` (этап 1 в `<head>`: блок между метками errlog:begin/end в index.html и `ERR_HEAD` в page.js; этап 2 —
  `js/core/errlog.js`). После ЛЮБОЙ правки errlog.js: `node scripts/make-errlog.mjs` (файл и блок генерируются; errlog-test и CI ругаются,
  если устарели). Отчёты → `POST /api/diag` (api/_lib/routes/diag.js, лимиты, 10 функций из 12) → `ops.sql` → «🩺 Ошибки сайта» в панели
  админа (js/features/ops-admin.js, грузится по кнопке). Ни ников, id, почты, токенов, адресов с запросом, IP: **в тексте
  `throw new Error`, `Promise.reject`, `d37Err('где', e)` данных игрока быть не должно** (очистка не поймает свободный текст). Рекламу,
  Метрику, расширения, «Script error.» этап 1 отсеивает сам. Автопроверки: `node scripts/ci-run.cjs` (локально; `DEPS_DIR` с three,
  Rapier, PGlite — см. шапку скрипта) = то, что GitHub Actions гоняет на push в main и PR (`.github/workflows/tests.yml`, Windows,
  ~2 мин); Vercel выкладку НЕ ждёт (по умолчанию) — красный крестик на коммите = разобраться; задержку можно включить в панели Vercel
  (Deployment Checks → GitHub, по документации Vercel — для всех проектов с GitHub, на Hobby не проверено; решает владелец, docs/OPS.md).
  Новая проверка — строка в `TESTS` ci-run.cjs (ops-test следит, чтобы новые *-test.cjs не забывали).
  Тест, который копирует `api/` выборочно, ломается при новом `import` в page.js — копируй всё `api/`. Копии базы: `scripts/backup-db.ps1`
  → `E:\backups\dan4ik37\ГГГГ-ММ-ДД.sql.gz` (только ПК владельца; репозиторий ОТКРЫТЫЙ — дампы в Actions и в git НИКОГДА; `backup.env` в
  .gitignore; проверено подменным pg_dump, на живой базе агенты не запускают).

## Локальный запуск
`python scripts/serve.py 5500` в корне → `http://localhost:5500/` (как `python -m http.server`, но с заголовками и переадресациями
из vercel.json: /chat, /play/… → index.html, мусор — 404.html со статусом 404; без заголовков не работает сборка Rust в студии).
`/api/*` и серверные страницы (/forum, /games/<id>, /videos…) локально отдают 404 — это нормально (это Vercel-функции).

## Как устроено
- Роутер: `js/ui/router.js`, объект `PAGES` — какие блоки (`id`) показывать в каждом разделе. С 22.10 (T-007) адреса НАСТОЯЩИЕ:
  /chat, /forum/42, /profile/vip, /play/chess/abcd (игры — /play: /games и /games/<id> — страницы для поиска); откат одной строкой —
  `ROUTING = 'hash'` в js/core/config.js. Карта адресов — `D37Route` (toPath/toHash, тест routes-test) и docs/progress.md «Фаза 1 —
  адреса». Правила: раздел читать `D37Route.hash()` / `currentRoute()` / `currentRouteParam()` ('#/games/chess/abcd' в обоих режимах),
  НЕ `location.hash` (в режиме адресов он пустой); переход раздела слушать событием `'d37:route'` (не hashchange); писать
  `location.hash = '#/…'` и ссылки `href="#/…"` можно — роутер сам ставит настоящий адрес, но видимые ссылки лучше сразу настоящие
  (`/chat`, `D37Route.href('#/…')`); адрес без перехода — `D37Route.setUrl('#/…')`, ссылка «поделиться» — `D37Route.abs('#/…')`;
  свой адрес, открыть перезагрузкой (серверная страница с тем же адресом, что раздел) — `data-server`. Новый раздел = `id` в `PAGES`
  + rewrite в vercel.json (→ /index.html, после серверных страниц) + SPA_PATH в sw.js. /about, /shop, /forum…, /ideas… — общий адрес
  у серверной страницы и раздела: из серверной страницы в раздел — ссылкой `/#/раздел` (page({ spa }) — вкладка-приложение уходит
  в раздел сама). `<base href="/">` в index.html — относительные адреса файлов от корня. Заголовок, описание, canonical, noindex —
  `ROUTE_META` в router.js (раздел уточняет `D37Route.meta({ title })`). Тест в Chrome — scripts/routes-e2e.cjs.
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
  (если на канале удалили/скрыли много роликов или вышло больше 200 новых). Страница ролика /v/<id> — из снимка
  `api/_lib/video-details.js` (описание, длительность, просмотры, теги; `videoFromSnapshot` в video-snap.js) без квоты API;
  в API — только ролики новее снимка. Тот же скрипт пересобирает оба файла. Квота YouTube общая с главной сайта (тот же ключ)! Похожие ролики — `relatedVideos()` в yt.js. Аудит и план — `docs/SITE_AUDIT.md`.
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
- «Шрифты для ника»: `/tools/fonts` → api/_lib/routes/fonts.js, стили — `makeFonts()` в api/_lib/fonts.js (тот же код в браузер
  через toString(); `?t=ник` — открыть со своим ником). «CPS тест»: `/tools/cps` → routes/cps.js (`?s=&n=` — вызов, noindex).
  Обе — карточками в «Играх» (GAMES с href), в поиске (SITE_PAGES), подвале и карте сайта.
- «Тесты» `/quiz`, `/quiz/<slug>` → routes/quiz.js, данные — api/_lib/quizzes.js (8 вопросов × 4 ответа, 6 результатов, очки
  поровну; новый тест = объект в QUIZZES). Результат — ссылка `?r=<id>` («Твой друг получил…», noindex).
- Картинки-превью ссылок (Telegram/ВК) для тестов и инструментов — img/share/<id>.png, рисует `python -X utf8 img/share/_make-cards.py`
  (Segoe UI без символов ★ 亗 ꧁꧂ — в подписях их не писать, будут квадратики).
- «Колесо фортуны» `/tools/wheel` → routes/wheel.js (crypto-рандом заранее, колесо доворачивается; `?o=a|b|c` — свои варианты, noindex).
- «Самые популярные видео» `/top` → routes/top.js (просмотры из снимка, шортсы — #shorts или ≤3 мин с 15.10.2024; без isGambling).
- Главная берёт ролики с `/api/feed` (routes/feed.js, CDN 15 мин) — квота YouTube не зависит от числа посетителей;
  не ответил — loadYT() по-старому идёт в YouTube API сам (так и локально, где /api нет).
- «🔴 в эфире» — js/core/live-badge.js на всех страницах (decapi, кэш 2 мин в sessionStorage; SPA — кнопка в углу, кроме #/home,
  #/chat и игры; серверные — полоска под шапкой). «🟢 Сейчас на сайте: N» на главной — presence чата → событие d37:online.
- /topic/<slug>: «🔥 Самые популярные» (просмотры из снимка) и кнопка теста по игре; /games — блок «Ещё на сайте» (тесты, инструменты).
- Все серверные страницы — одна функция api/pages.js (ROUTES) + rewrite в vercel.json. Функций сейчас 10 из 12.
- Форум и идеи для поиска (T-007): /forum, /forum/<id>, /ideas, /ideas/<id> — api/_lib/routes/forum.js (JSON-LD DiscussionForumPosting,
  ItemList, BreadcrumbList; текст игроков — publicText(): чужие ссылки, телефоны, почта, @ники скрыты, мат закрыт — список как в
  phone.js; без рекламы; метка 12+). В карте сайта — темы и идеи (кроме отклонённых) и разделы /chat, /shorts, /donate, /lfg…;
  robots.txt закрывает /api/ (кроме /api/feed, /api/ids), /auth/, /go/, /profile, /phone, /adv, /invite, /chat/…, /shop/….
- «Генератор ников для игр»: `/tools/nick` → `api/tool-nick.js` (SEO: «генератор ников», «ник для роблокс»), словари и
  генерация — `api/_lib/nicks.js` (тот же код уходит в браузер через toString(); примеры в HTML — с зерном, не меняются).
- Поиск по сайту: `js/ui/hotkeys.js` (Ctrl+K, «/», кнопка 🔍 в шапке) — разделы + `SITE_PAGES` (серверные страницы: /vip,
  /videos, /tools/nick…), игры (GAMES), видео (allVids → /v/<id>) и весь архив по `/api/ids?t=1` (грузится при первом поиске). Общий HTML-шаблон и стили — `api/_lib/page.js`,
  YouTube — `api/_lib/yt.js`. Локально проверять вызовом handler'а из node (копия api/ во временной папке с
  `package.json` `{"type":"module"}`). Новая игра → добавить и в `GAME_PAGES`.
- Ролики про кейсы/промокоды на депозит (GGDROP, CaseBattle…, ~490 из 6000): `isGambling()` в yt.js → `/v/<id>` рендерится
  с `noAds` (без скрипта AdSense и без места рекламы) — AdSense запрещает рекламу рядом с азартными играми.
  То же правило: /videos?p=N, где есть такие ролики, — noAds (страницы 3–12); на /topic, /top, «первое видео года» в /history
  их не показываем. Новая серверная страница со списком роликов — фильтровать isGambling или ставить noAds.
- Реклама: номера блоков — `window.ADS_IDS` в `js/core/ads-core.js` (РСЯ `R-A-…` и/или Google; Яндекс главнее — Google в РФ
  рекламу не показывает; пусто — места нет; у Google запасные: loading/break/rail → блок game_over, feed → games_hub). Когда и где —
  диспетчер `js/core/ad-places.js` (`D37AdPlaces`, правила `ADS_RULES`; агент 15.10.2026): каждое место спрашивает `why()`, показ —
  `show()`/`mark()`; до 40 показов за визит (вкладка, sessionStorage `d37_ads_s`, 30 мин тишины — новый визит). VIP и персонал — без
  баннеров (`noAdsPerk`; память `d37_noads` для серверных страниц; AdSense на паузе строчкой `pauseAdRequests` в `<head>` index.html
  и page.js), реклама за награду — по их кнопке. «Рядом нельзя»: `ctx('gambling')` (noAds-страницы — и без полоски РСЯ), чужие
  игры/миры без проверки (studio|unity play/edit/new/mod, studio3d play/join — без loading/break/rail/feed), идёт партия — без перерыва.
  Места: game_over (под игрой; обновлять — только Яндекс, ≥ 90 с), break (компьютер, каждая 3-я партия «☕ Перерыв» под игрой: не в
  первые 2 мин, ≥ 5 мин, до 4), loading (экраны загрузки мира, Студии 3D, игр, сборки C++/Rust — только если дольше 1,5 с, с
  подсказкой, загрузилось — сразу прочь; ≥ 90 с, до 6), feed (карточка «Реклама» в списках: витрина игр после 10-й и 20-й, лента
  видео после «ещё», /videos каждые 30, каталоги «Студии игр»/Unity только public; грузится у экрана, нет рекламы — своя подсказка;
  до 16), rail (компьютер ≥ 1400 px: один столбик 300/160×600 справа от игры, ≥ 40 px от окна игры, у Google ≥ 150 px от игры;
  липнет вручную — у html/body overflow-x: hidden; накрыло окно — убрать; ≥ 60 с, до 12), interstitial (телефон, игры зовут
  `D37Ads.interstitial()`: не после первой, ≥ 3 мин), floor (телефон 320–420 px, с 12 с). Новое место — через
  `D37AdPlaces.show()/feed()/loading()`, не `D37Ads.render` напрямую. Монеты за рекламу — `coinOffer('где')` (раз в 10 мин,
  событие `d37:coinad`; только 🪙, не 💎 и не деньги). Щиты «Мира Денчика» (`js/games/mir-promo.js`) — свои промо и спонсор из
  site_config `ad_sponsor` (админ: «⚙️ Настройки сайта» → «📣 Спонсор»; по закону «Реклама», рекламодатель, erid из ОРД) — не
  реклама сетей (её в 3D рисовать нельзя). `ADS_IDS.kids` = 0 (1 — запросы Google «для детей»: меньше дохода, меньше риска —
  решает владелец). Отладка: `?adsdebug=1` рамки вместо рекламы, 2 — без лимитов, 3 — настоящая с обводкой, 0 — выкл;
  `D37AdPlaces.state()`. Тест: `node scripts/ads-test.cjs` (227). Старые AdSense-блоки — `AD_SLOTS` в config.js + `js/features/ads.js`.
- 📣 Реклама за 💎 — кабинет рекламодателя (#/adv, ads.sql; агент 15.10.2026; владелец: «оплатил — выставил рекламу, и она показывается
  как гугл»). Любой вошедший, принявший /ads-terms, делает кампанию: карточка в ленте, баннер 300×250/728×90, столбик 160/300×600, щит в
  3D-мире; https-ссылка; рекламодатель, ИНН/БИН, erid; возрастная метка (обязательно); разделы, устройства, возраст, Россия/не Россия,
  даты; CPM или пакет «по дням». Кабинет — js/features/adcab.js + css/adcab.css; админ #/adv/admin — очередь, одобрить/отклонить с
  причиной, блок, метка, итоги, цены. Деньги: отправка → premium_add(−бюджет, 'ads', id) в копилку; показ CPM — bid/1000, пакет — день
  при первом засчитанном показе (МСК); отказ/стоп/конец/бюджет/блок → остаток сам назад ('ads_refund'). Цены (💎, CPM/день): карточка
  70/60, баннер 50/50, столбик 60/40, щит 100/100; бюджет от 200 (ads.sql = js/core/ad-direct.js DEF = api/_lib/ad-rules.js, тесты
  сверяют). Показ: ad-direct.js через D37AdPlaces — своя кампания раньше сети; ad_live (нет кампаний — ни одного лишнего запроса),
  ad_pick (вес по ставке, частота 6/день); без erid — только зрителям вне России (/api/geo; неизвестно = Россия); метка не старше
  группы, детям щита нет. Засчитывание: видно ≥ 50 % ≥ 1 с → ad_view (подпись выдачи, раз в 30 мин, свои/роботы/флуд не считаются).
  Клик — /go/<id> (api/_lib/routes/adgo.js → ad_go, 302). На рекламе — «Реклама 12+ · рекламодатель · erid», «ⓘ О рекламе» (жалоба:
  3 — пауза до админа). Картинки — закрытое хранилище ads. Закон — docs/ADS_CABINET.md (показать юристу). Тесты: ad-direct-test (149),
  PGlite test-ads.mjs (259). Во встроенном браузере IntersectionObserver стоит — показы проверять в node.
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

## Известные хвосты
- AdSense: сайт в кабинете зарегистрирован как dan4ik37.github.io и отклонён («бесполезный контент»); главный адрес —
  dan4ik37.vercel.app (github.io перенаправляет туда). Номера блоков вписаны; Google в РФ рекламу не показывает —
  для российских зрителей потом подключить РСЯ (`ADS_IDS.yandex`).
- Скриншоты во встроенном браузере при прокрутке бывают чёрными, а rAF/IntersectionObserver стоят, пока панель
  не отрисовывается, — это особенность среды, не сайта.

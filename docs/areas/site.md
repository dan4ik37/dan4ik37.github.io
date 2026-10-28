<!-- Moved verbatim from CLAUDE.md on 2026-10-28 (CLAUDE.md is now a short English index). Russian, as written then. When you change this area, rewrite the part you touch in short English. -->

## Приложение (PWA) на ПК и телефонах — js/features/app.js, sw.js, docs/APPS.md (агент 15.10.2026)
- Владелец: «полноценные приложения на ПК и другие устройства… но реклама же будет?» — сайт ставится как программа (PWA): реклама
  AdSense/РСЯ работает (это веб-страница). Electron/Tauri — НЕЛЬЗЯ: AdSense запрещает код «в программах». Таблица рекламы по
  платформам, Google Play / RuStore (TWA) / Microsoft Store (MSIX) / iOS — docs/APPS.md (аккаунты заводит владелец).
- app.js (D37App): кнопка браузера (beforeinstallprompt), «📲 Установить приложение» в «Ещё» (в ☰ — плитка), в профиле
  ([data-app-install]) и в ⚙️ Настройки → Сайт; разовая карточка с 3-го захода (не вместе с окошком возраста, не поверх игры/окон/
  звонка, ≤ 2 показов); окно «Как установить» с SVG-картинками — app-guide.js (поменял — VER в app.js); #/app — сразу оно (ссылка
  для соцсетей). В окне приложения: html.app-standalone (+ app-wco, app-ios/android/desktop), «⟳ Обновить» в меню, «Назад» на
  Android закрывает окна сайта, на ПК шапка — заголовок окна (window-controls-overlay), в тесном окне лишние пункты шапки уезжают в
  «Ещё». Значок на иконке = ЛС + пропущенные звонки + 🔔 (d37:dm-unread, d37:notif, d37:badges из phone.js). «Поделиться»
  (share_target) → общий чат или ЛС; ссылки web+denchik: (с цифрами по правилам HTML нельзя); launch_handler focus-existing.
  ?app=play|rustore|ms → D37App.source(); app-play прячет покупки (правила Play Billing).
- Настоящие адреса (T-007): sw.js v5 — разделы по настоящим адресам (SPA_PATH = rewrites → index.html) открываются оболочкой и без
  сети; ярлыки manifest — /play/world, /chat, /play, /play/words (Магазин — /#/shop: у /shop своя страница); ссылка, открытая в уже
  запущенном приложении (launchQueue), по настоящему адресу раздела — тоже без перезагрузки (app.js launchAction).
- sw.js: поменял — подними VERSION (у всех «✨ Доступна новая версия — Обновить»). Кэши только свои: d37-shell-<VERSION> и d37-rt-v1
  (раньше старый sw.js стирал ВСЕ кэши, в т. ч. 38 МБ кэша сборки Rust). НИКОГДА не кэширует: /api/*, /go/*, /studio/*, Supabase,
  рекламу, Метрику, YouTube, Twitch. Главная и скрипты без ?v= — сначала сеть. Офлайн-игры — OFFLINE_GAMES в app.js = список в
  offline.html (тест сверяет; с 22.10, sw.js v6, — и «Клеточки» с «Червячками»: с ботами без сети; без интернета «▶ Играть» в них
  уходит к ботам за ~1 с; проверено в Chrome: `node scripts/room-net-e2e.cjs C`). Значки — python -X utf8 scripts/make-app-icons.py; снимки — node scripts/app-shots.cjs. Тесты: node
  scripts/pwa-test.cjs (254) и node scripts/pwa-e2e.cjs (настоящий Chrome). Магазины: .well-known/assetlinks.json (ЗАМЕНИТЬ-1/2/3 —
  отпечатки ключей), apps/android/{play,rustore}/twa-manifest.json; ключи подписи и .apk/.aab/.msix — НЕ в репозиторий.
  На проде в обычном Chrome ещё проверить: установку, заголовок окна, значок, «Поделиться» на Android, push на iPhone, «Обновить».

## 👥 Приглашения друзей (referrals2.sql, js/core/ref.js, js/features/invite.js; агент 15.10.2026, подробно — docs/REFERRALS.md)
- Код — 6 знаков, ref_codes; ссылка /r/<код> (api/_lib/routes/ref.js в pages.js + rewrite; превью img/share/invite.png, noindex, без
  рекламы; ?to=<маршрут> — сразу в игру/комнату/мир). Старые ?ref=<ник> работают. «👥 Мои приглашения» — #/invite (ссылка, Telegram/VK/
  WhatsApp/«Скопировать», QR-код js/core/qr.js, кто пришёл, награды, топ), админ — #/invite/admin.
- Код ловится на любой странице (ref.js в SPA, REF_HEAD в api/_lib/page.js): localStorage d37_ref2 (+ зеркало d37_ref для почты), 30 дней,
  первое касание, свой код не ловится. Привязка: почта — сразу (метаданные → триггер ref_on_profile), вход через сервис — по d37:signup
  или следующему d37:auth → ref_claim (аккаунт ≤ 7 дней, один раз). В окне входа — строка #gauthRef над #gauthOauth.
- Любая ссылка «позвать/поделиться» — через (window.D37Ref?.wrap || (u => u))(url) (дописывает мой код). Новое место — так же.
- Числа — ОДНО место на сервере: ref_rule() / ref_ladder(), копия — RULES/LADDER в ref.js (referral-test сверяет). Награды только за игру
  друга: его 3/5/10 уровень → пригласившему +25 XP +30 🪙 / +25 XP +50 🪙 / +100 🪙; новичку на 3 уровне — 50 🪙 + след «Конфетти»;
  ступени: 1/3/5 друзей с 5 ур. — попугай / мегафон / рамка «Посол» (lv-frame-ref), 10 друзей с 10 ур. — след «Салют» + 500 🪙. Вещи «за
  друзей» — 8-е поле PARTS (ref: 1), не продаются (gen-skin-sql пропускает).
- Бонус за поддержку: 10 % 💎 друга за настоящие деньги (premium_ledger 'pay' не тест и 'donation'; донат «VIP сразу» — по donate_rate),
  12 месяцев, до 500 💎 в месяц (МСК); возврат — бонус назад пропорционально, потрачено — долгом. Дети — без бонуса. Деньгами — никогда.
- Защита: свой код / по кругу / то же устройство (d37_dev) — «сам себя», без наград; тот же IP за 30 дней, устройство у другого аккаунта,
  3+ друзей с одного IP — «на проверку» (награды ждут админа); 10 наград в сутки и 60 за 30 дней. IP/устройство — только хеш (90 дней).
  Приватность: пригласивший видит у друга ник и уровень; дети и скрытые — «🕶 Аноним» в топе. referrals2.sql переопределяет
  referral_count, top_referrers, prevent_referred_by_tamper и убирает старые триггеры xp_on_referral / notif_on_referral. Тесты: node
  scripts/referral-test.cjs (125), PGlite pg/test-referrals2.mjs (168).

## Вход через другие сервисы (auth-links.sql, api/_lib/social.js, routes/oauth.js, js/features/social-login.js; агент 15.10.2026)
- Владелец: «вход через другие сервисы, но чтобы не было обходов и вредных действий для сайта и ботов». Кнопки «Войти через…» в окне
  входа (#gauthOauth, блок ▼▲) — только включённые: VK ID, Telegram, Яндекс ID (свои, через сервер; /api/oauth?a=providers = переменные
  Vercel + auth-links.sql) и Google, Discord, Twitch, GitHub (Supabase /auth/v1/settings). Пошагово — docs/LOGIN_PROVIDERS.md.
- Свой вход: /auth/<p>/start (rewrite → api/pages.js?page=oauth; функций по-прежнему 10): state + PKCE в подписанной куке (HttpOnly,
  только /auth, 10 мин) → сервис → /auth/<p>/callback: state одноразовый (auth_once), код → токен (секрет — в Vercel), берём только
  номер, имя и аватарку, токены не храним. Номер → аккаунт: auth_links; нет — новый аккаунт admin API со служебной почтой
  <p>-<номер>-<hex>@id.invalid (писем нет, в профиле не видна). Вход без письма: generate_link magiclink → hashed_token в зашифрованном
  пропуске во фрагменте #d37auth=… → /api/oauth?a=finish (+ секрет вкладки) → verifyOtp({ token_hash, type: 'magiclink' }); 3 мин,
  один раз. Telegram: виджет (TELEGRAM_BOT_TOKEN + NAME, подпись HMAC, auth_date ≤ 5 мин, один раз) или OpenID (TELEGRAM_CLIENT_SECRET).
- Привязка — профиль → «Способы входа» (#/profile/logins): только со свежим входом (≤ 15 мин, иначе «Подтверди, что это ты»).
  Последний способ не отвязать (клиент, SQL, триггер). О каждой привязке — 🔔. По почте НЕ склеиваем (VK/Яндекс/Telegram почту не
  спрашивают; триггер auth.identities — авто-привязка только Google и только к аккаунту с этой же своей подтверждённой почтой).
- Боты: новые аккаунты через VK/Яндекс/Telegram — ≤ 3 в сутки с одного интернета (отпечаток HMAC за день, адрес не храним) и ≤ 60 в час
  на сайт — auth_limits(). Turnstile (D37Captcha): TURNSTILE_SITE_KEY в config.js. Бан ника → отпечатки всех входов в auth_link_bans
  (через них не создать новый аккаунт). Модератору — «🔗 Входы (N): …». Новый аккаунт → событие d37:signup { provider, userId }
  (для рефералов). Классы lgn-* (sl-* — пасьянсы!). Тесты: node scripts/auth-test.cjs (141); PGlite pg/test-authlinks.mjs (130).
- ИСПРАВЛЕНО 15.10 (js/features/auth-guard.js, D37AuthUrl): раньше supabase-js молча принимал ЛЮБУЮ ссылку #access_token= (login
  CSRF), а Метрика (url: location.href) получала адрес с токенами. Теперь скрипт в <head> index.html (ДО Метрики и AdSense) забирает
  токены/ошибки/#d37auth/#tgAuthResult и метку ?oa= в window.__d37AuthHash и стирает их из адреса; chat.js — createClient(…, { auth:
  { detectSessionInUrl: false } }). Молча — только свой вход (почта/«Забыли пароль?» — отметка d37_authmark на сутки; Google… —
  d37_oauth + одноразовая ?oa=) и если не открыт другой аккаунт; иначе «Войти как <ник>?» («Нет» по умолчанию). PKCE не берём
  (письмо на другом устройстве не сработало бы). В Supabase Redirect URLs нужен https://dan4ik37.vercel.app/**. Новый вход с токенами
  в адресе — только через auth-guard.js. Тесты: auth-test (170), scratchpad ui-urlguard.cjs (41).

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

## Полный экран, «⚙️ Настройки», поворот телефона (js/core/fullscreen.js, js/core/settings.js; агент 15.10.2026)
- D37Full — один полный экран на всё: шапка игры (#gamesStage), «Мир», «Студия 3D» (.s3), окно Unity (.un-box). CSS закрепляет
  элемент во всё окно (el.gs-fs; html.gs-full прячет шапку, нижнее меню, плашки и кнопки сайта; у предков снимаются
  transform/z-index — .gs-anc: у .reveal.visible transform ломал position: fixed). Fullscreen API — на ВСЕЙ странице
  (documentElement), а не на элементе: иначе не видно окон сайта поверх игры (вход, ⚙️, редактор персонажа, всплывашки). Нет API
  (iPhone) или отказ — режим pseudo (только CSS; размер холста ловит ResizeObserver); на время полного экрана в meta viewport
  viewport-fit=cover (вырез — env(safe-area-*)). Esc и «Назад» (своя запись истории) выходят; внутри .gs-noesc (мир, студия) Esc —
  игре. Кнопки без кода: data-gs-full="#gamesStage" (⛶), data-gs-rot (🔄: полный экран + screen.orientation.lock; не вышло за
  1,5 с — подсказка «Поверни телефон»). games.js: D37Full.auto(stage) — телефон лёжа → игра сама во весь экран (html.gs-compact),
  обратно — выход; release(el) — игру закрыли переходом: выход БЕЗ history.back. Экран не гаснет (Wake Lock). Событие
  'd37:fullscreen'. Слой полного экрана — z-index 9100 (всплывающая реклама — выше; столбик рекламы при gs-full убирается).
- Телефон лёжа: шапка игры — колонкой слева; DOM-игры выше экрана games.js gamesFit уменьшает целиком (transform; кроме
  world/studio3d/horde/unity). Поэтому нажатия в играх считать ДОЛЕЙ от getBoundingClientRect (arena, pool, td, catch, пасьянсы
  уже так). manifest.json: orientation any (установленный сайт тоже поворачивается).
- D37Settings — окно «⚙️ Настройки»: Графика (gfx, fsr + «100%», shadows, fps, world2d) / Звук (mute, vol, volFx, volAmb, volVoice —
  для звонков) / Управление (клавиши: 2 на действие, геймпад, конфликты; sens, invertY, touchSize, touchAlpha, lefty) / Камера
  (view, fov, motion, shake) / Интерфейс (uiScale, tags, bubbles, autoFull, autoLand) / Сайт (режим сайта → setPerf, push,
  приватность). В 3D — все вкладки, в обычной игре — звук, интерфейс, сайт. Хранилище d37_settings; старые d37_gfx, d37_fsr,
  d37_keys, d37_games_mute, d37_cam_sens, d37_cam_motion, d37_world_2d перенесены и остаются ЗЕРКАЛОМ (их читают движок и старый
  код). «На живую» — window.D37Opt (rev): render.js (FSR, R.setShadows, FPS), camera.js, controls.js (keysRev), synth.js, input.js
  (левша); CSS --gs-ui, --gs-touch / --gs-touch-a, html.gs-lefty / gs-notags / gs-nobub. Свои вкладки —
  D37Settings.addTab({ id, icon, title, order, ctx, render(el, S) }), свои значения — define(); игра с движком —
  D37Settings.context({ engine: true, R, gfx(), world2d(v), view(v), onClose }). Открыть: шапка игры, мир, студия, меню сайта
  «Ещё ▾» / ☰ → «⚙️ Настройки».
- Одно меню на игру (T-043, владелец 22.10: «Зачем тут 2 меню?»): ⚙️ Настройки, ⛶ полный экран (+ «🔄 Повернуть экран» на телефоне
  стоя), ❓ — только в меню ☰ (оно же Esc и Start геймпада; на телефоне Esc нет). Пункты экрана — общие: ...D37Settings.fsItems(el) и в
  onPick D37Settings.fsPick(id, el, меню) (⛶ — меню остаётся, 🔄 — закрывается). «Мир»: .wld-topbtns = 🗺️ Карта · 🏘️ Участок · 📱 Телефон
  · ☰ Меню (.wld-menubtn, последняя; 💬 — телефон лёжа, 🎬 — в городах, 🏯 — в боевой зоне; свои кнопки — ПЕРЕД 💬/☰). «Кубомир»: в
  панели только ☰ (в мире — меню паузы, в списке миров — настройки, ⛶, ❓, «Все игры»). «Подземье»: ☰ Меню в HUD (P), ⛶/🔄 — в паузе и
  на стартовом экране. У игр со своим меню шапка игры без ⚙️ 🔄 ⛶: #gamesStage.gm-own-bar (своя панель: мир, Кубомир) или .gm-own-menu
  (Подземье); games.js снимает оба при закрытии. Обычные игры — ⚙️ 🔄 ⛶ в шапке (одно место; у «Орды» второй ⛶ на поле убран).
  Esc в мире — сначала свои окна (зоны, карточки, стройка), потом меню; от 1-го лица браузер отпускает мышь — меню само. Пока меню или ⚙️
  открыты — C.blocked, после — C.reset_state. Студия: ⚙️ ⛶ в верхней панели (телефон — «••• Ещё»), V в игре (1-е/3-е лицо).
- Окно ⚙️ (T-043): первая вкладка «⭐ Главное» (по месту: качество графики, шейдеры, чувствительность, громкость, вид; в обычной игре —
  громкость и размер кнопок; с сайта — и режим сайта) — строки D37Settings.addMain({ id, order, ctx, when(cx), html(cx) }) с теми же
  data-set / data-sw / data-range; открывается по умолчанию (свой tab — open({ tab })). «🔍 Найти настройку» в шапке: рисует все вкладки
  места секциями (render(el) — в свой div секции, обработчики вкладок вида body.onclick — на нём) и прячет строки .gs-row/.gs-krow без
  слов запроса (название, подсказка, варианты, data-words; ё = е; окончание отбрасывается, основа — с начала слова). «↺ Сбросить»
  внизу: «Главное» — всё (reset), вкладка с keys: [...] / reset() в addTab — только она (D37Settings.resetKeys(keys) — событие «*» с keys).
  Подсказки — одна короткая строка (row(…, { words })). Стрелки и Enter/Пробел в меню и окне (игра под ними отменяет их «по умолчанию» —
  settings.js keyActivate нажимает сам); геймпад (опрос — только пока открыто меню/окно и есть геймпад): ↑↓ / стик — строки (группы
  вариантов — целиком), ←→ — ползунок / варианты, Ⓐ — нажать при ОТПУСКАНИИ (игра не «прыгнет»), Ⓑ — назад, LB/RB — вкладки. На телефоне
  — кнопки ≥ 40–44 px, без размытия под окном и меню (3D рисуется под ними каждый кадр). Фокус после перерисовки — на том же (focusSig).
- Тест: node scripts/settings-test.cjs (214); в Chrome — node scripts/menu-e2e.cjs [shots|games|perf|leak|pad|tour] (снимки — D37_TMP / SHOTS,
  TAG=before|after, SITE_DIR — копия «до»; leak — память целиком (T-090): мир на ПК и на телефоне ×4 — каждая зона построена один раз,
  20 кругов ☰ → ⚙️ → все вкладки → поиск и столько же без меню — не больше LEAK_MB = 6, страница игр, «Кубомир», «Подземье»; чужие
  скрипты — Метрика, реклама — заблокированы). Во встроенном браузере API полного экрана не отвечает — проверяется режим pseudo;
  transition, resize и ResizeObserver стоят, пока панель скрыта (для проверки — *{transition:none!important} и
  dispatchEvent(new Event('resize'))).
- Кнопки телефона — js/core/touch-layout.js (D37TouchLayout, T-074; грузится в index.html после settings.js): игра даёт кнопки и
  раскладку по умолчанию (attach({ id, title, el, items, btn, defaults(W, H, k, { lefty }), apply, avoid, onEdit })), помощник
  расставляет (стили — только при смене окна, «Размера кнопок», левши, раскладки) и держит редактор «🎮 Настроить кнопки»
  (⚙️ → «Управление»: строка — settingsRow(), кнопку [data-tl-edit] ловит сам; у «Подземья» — в его вкладке ⛏): перетащить, «−/＋»,
  «Как было», лёжа и стоя отдельно, localStorage d37_touch_layout (от ближнего края; битое отбрасывается). Подключены: «Кубомир»,
  «Подземье» (apply — его --d/--x/--y, левша — его зеркало), кнопки движка ui.js (без своей раскладки — сетка как была, со своей —
  .tl-free; набор кнопок = своя раскладка: «Мир» и «Студия 3D» общая). Редактор: кнопки панели — по «отпустил», следующий клик
  глотается (иначе попадал в ⚙️ игры под пальцем). Тесты: touch-layout-test (28), touch-hud-e2e (TH_MODE=full; GAME=podzem|world).

## 🎂 Возраст и возрастные метки (js/core/age.js, age.sql, api/_lib/age.js; агент 15.10.2026)
- Владелец: «выбор возраста, реклама от типа возраста, режимы помечать возрастом, но вся информация конфиденциальная». Спрашиваем
  только ГОД рождения («Не хочу указывать» — можно): окошко при первом заходе в SPA (через 7 с, не поверх игры; «Потом» — 3 дня), поле
  в регистрации, ⚙️ Настройки → «Сайт» → «🎂 Возраст» (Изменить / Удалить). Гость — localStorage d37_age; вошедший — user_age (читает
  только сам: ни модераторы, ни админ, не в profiles); при выходе копия в браузере стирается; гостевой год уходит в аккаунт один раз.
  Год НЕ уходит в адреса, Метрику/Vercel, presence, сообщения; Google получает только «обработку» 1/2.
- D37Age.group(): child <13 · teen 13–15 · teen16 16–17 · adult · unknown; возраст «не меньше» (год по МСК − год − 1). allows(r) —
  строго, canOpen(r) — плюс «👨‍👩‍👧 Взрослый разрешил» (12+/16+ до конца визита; 18+ несовершеннолетнему — никогда). Смены: первые сутки —
  опечатка, дальше 2 за 30 дней; стал «старше» или стёр — 30 дней правила прежней группы. Ранняя метка в <head> (index.html = AGE_HEAD
  в page.js, тест сверяет): html.d37-h18 — прятать [data-age="18"], d37-c18 — возраст не указан.
- Реклама — ADS_RULES.age (ad-places.js): Google data-tag-for-age-treatment 1 (<13) / 2 (13–17) (новая метка вместо
  child-directed, справка AdSense 17042704) + requestNonPersonalizedAds; unknown → 'teen' (ADS_RULES.age.unknown; 'adult' — больше
  дохода, решает владелец). Детям — без полноэкранной, полоски, награды, спонсора щитов, до 20 показов (у РСЯ «детского» параметра
  нет — блокировка тематик в кабинетах). ADS_IDS.kids — весь сайт строже. В <head> AdSense на паузе всегда, снимает gate() в ad-places.js.
- Метки: игры — GAMES[].age/ageWhy = GAME_AGE (api/_lib/age.js); разделы — AREAS (чат, форум, тиммейты 12+; магазин 0+; router.js →
  gateRoute); ролики — TOPICS[].age / AGE_EXTRA / VIDEO_AGE_DEFAULT (topics.js, по умолчанию 12+) = VIDEO_RULES (age.js), кейсы/депозит
  18+; игры игроков — age_rating (автор до 16+, модератор любую; по умолчанию 12+). Не по возрасту — обложка; 18+ несовершеннолетнему
  нет в ленте, Shorts, поиске, «Удиви меня», /videos и «похожих» (data-age="18"). Сайт — 12+ в подвале. Казахстан (закон 169-VI от
  02.07.2018): категории «6–», 6+, 12+, 14+, 16+, 18+ (нет 0+, есть 14+) — уточнить у юриста и перемапить при необходимости.
- Безопасность: ребёнку — заявки в друзья «ни от кого» (сервер, один раз), в чате/сообществах ссылки скрыты (кроме роликов и игр) и
  контакты — kidText (msgview.js, в ЛС — нет), в мире — строгий фильтр, магазин без карты (сервер: age_child). 13–15 — 1000/3000 ₽,
  16–17 — 2000/6000 ₽ (premium_settings.teen_*; ветка возраста — одинаковая в age.sql и premium.sql).
- Тесты: node scripts/age-test.cjs (214); PGlite test-age.mjs (99). Новая игра → age/ageWhy в GAMES + GAME_AGE; новая тема роликов →
  age/ageWhy в topics.js + VIDEO_RULES в age.js.
- Безопасность детей (T-010, 22.10, docs/REALMS.md «лёгкий вариант»; выключатель site_config 'kidsafe' = 'off'): ребёнок до 13 ↔ взрослый
  или «без возраста» — ни ЛС, ни звонков, ни заявок/принятия, ни приглашений; до 9 (age_u9; сменил год — ещё 30 дней) — чаты и сообщества
  только читать и реакции (state → { mode: 'readonly', react: true }), без ЛС, звонков, голосовых, своих сообществ. Сервер: age.sql
  (kidsafe_on, age_u9, kid_pair_ok, kid_why, kid_contact — ответ только про себя: взрослому всегда пусто; age_public_kids — только
  service_role), community.sql ч. 5 (триггеры dm_kidsafe / friend_kidsafe: ребёнку — текст причины, остальным — 42501 «как RLS»; chat_guard,
  cm_send, cm_create, cv_pass — до 9; call_pass / call_check — пропуск в звонок, ребёнок и взрослый друг друга не проходят;
  friends_online — без запрещённых пар). Браузер: D37Age.u9 / chatRO / contacts(ids) / friendBlock / KID_MSG (тексты = сервер, тест
  сверяет); ребёнок не рассылает «кто онлайн» с кодом комнаты; приглашения в мире — ребёнок проверяет отправителя по пропуску мира.
  Новое личное общение (свой канал, ЛС-подобное) — через kid_why на сервере. Ники детей на публичных страницах — publicKids/publicNick
  (api/_lib/age.js). Чат мира до 9 — только в браузере (broadcast). PGlite: E:\claude-tmp\kidsafe\test-kidsafe.mjs (441), perf-kidsafe.mjs.

## Защита от кода в чужом тексте (XSS; T-011, 22.10.2026)
- Правило: чужое (ники, чат, форум, названия сообществ/миров/игр, события, реакции, строки от соперника по сети, параметры адреса, файлы миров и
  модов) попадает в HTML только через `esc()` / `jsAttr()` (js/core/utils.js; на сервере `esc` из api/_lib/yt.js) или `textContent`. `esc` НЕ
  защищает: ссылку (`javascript:` после него остаётся — нужен путь «/…» / «#/…» или проверка https://), `onclick="f('${esc(x)}')"` (нужен
  `jsAttr`), `style="…"`, имя тега/атрибута, код внутри `<script>` (там знак «<» экранируют, как в JSON-LD api/_lib/page.js).
- Проверка — `node scripts/xss-test.cjs` (~30–90 с; в ci-run): scripts/xss-scan.cjs разбирает ВСЕ js/api/studio (acorn из самого Node, сам
  перезапускается с --expose-internals) и ищет вставки, которые нельзя доказать безопасными (не число, не константа, не esc/jsAttr, не
  проверенная ссылка). Прочитанные вручную лежат в scripts/xss-allowlist.json (файл + функция + вид + выражение → причина из `claims`);
  новая находка без записи ломает проверку. Дальше в том же тесте: злые строки через ленту чата, события, аватары, реакции, GameRoom.clean и
  17 серверных страниц с подменённой базой; места, откуда сервер отдаёт тело ответа (res.send/end), — только известные формы.
- Нашёл находку: сначала поправь код (`esc`). Только если значение на деле число / константа / id из базы / уже проверено —
  `node scripts/xss-scan.cjs --add <причина> "заметка"` (после чтения кода вокруг!); `--prune` убирает устаревшие записи. В onclick, ссылке,
  стиле, неукороченном атрибуте причины ограничены (xss-test: «peer-clean» там не годится).
- Строки от других игроков по сети (хозяин стола, соперник, напарник) `GameRoom.clean` (room.js) очищает от знаков < > & " ' и обратной кавычки при получении:
  room.js, table.js (все три пути), netplay.js, «Крокодил» fromHost. Свой новый транспорт — тоже через clean (или esc в каждом выводе).
- Исправлено 22.10: реакции на сообщения (любой вошедший писал в message_reactions.emoji разметку, renderEmoji выводил её как есть), uid чужого
  игрока в мире (UID_RE в mir.js / world.js), «сайт//чужой.сайт» как свой путь (чат, /forum), свойства и настройки миров «Студии 3D»
  (файл мира = произвольный JSON), строки от хозяина стола в картах и шахматах, ссылка рекламодателя в админке и виджет оплаты — только https.
  Файлы других агентов (kubomir*, podzem*, engine, mir-*, raid*) только прочитаны: там экранирование на месте, записи в списке — с пометкой.

## Свой сервер для игр (T-045; docs/SERVER.md — шаги владельцу и протокол) — server/ на Oracle владельца, клиент js/core/rt.js (D37RT)
- server/rt — Node 22 + ws 8.21.3 (без своих модулей), server/docker-compose.yml: rt (127.0.0.1:8787) + Caddy (Let's Encrypt
  IP-сертификат, профиль shortlived, default_sni) + coturn 4.18, всё в сети хоста, у всех mem_limit/cpus; server/ на Vercel не
  выкладывается (.vercelignore). Ставит владелец: sparse clone → `bash make-env.sh <IP>` (секреты — только server/.env на сервере)
  → `docker compose up -d --build`. Агенты к серверу не подключаются.
- RT_URL в config.js пустой (так сейчас) → D37RT.client() = null, всё как было. Задан → GameRoom.channel и IoKit.supaTransport
  берут канал у D37RT (тот же API, что у канала supabase-js; presence — тем же алгоритмом), netplay — его TURN, calls.js — через
  window.D37_TURN. Комната НЕ делится: сервер смотрит Supabase-канал каждой своей комнаты и, если там кто-то есть, переводит всю
  комнату и её «<комната>-…» в Supabase ('mv'); проба 40 КБ на сокет ловит «16 КБ» провайдеров; сервер упал — через 5 с всё в
  Supabase, presence на переезд «замирает» (игра не видит «соперник ушёл»). ?rt=0 — только Supabase в вкладке.
- Новая комната — по-прежнему через GameRoom.channel; канал без presence — только «сосед» presence-канала (имя «<комната>-…»),
  иначе сторож его не увидит. Поменял протокол — server/rt/src/hub.js и js/core/rt.js вместе. Этап 2 (мир, online-users,
  звонки, набор текста, postgres_changes, облачные сохранения) — docs/SERVER.md, Part 2.
- Журнал для античита (T-073 будет читать): server/rt/src/audit.js, выключен (AUDIT пусто); игра помечает свои «проверяемые» события
  в канале: config: { audit: { events: ['in'] } } (только ходы/ввод — не чат и не имена). Формат и пределы — docs/SERVER.md «Anti-cheat feed».
- Тесты: rt-test (144; ws@8.21.3 + @supabase/supabase-js@2.117.2 в DEPS_DIR — в CI ставятся), rt-load-test (`--quick` в ci-run;
  без него — 1000 соединений, `--prio` на занятом компьютере), rt-e2e (--e2e: два Chrome, настоящий Supabase, сервер убит).

## Mini-card, Profile 2.0, light theme (T-086, 22.10.2026)
- Flags in js/core/config.js, one-line rollback each: `UI_V2` (html.ui2 — Profile 2.0 layout; any `#/profile/<uuid>` link opens the
  mini-card) and `THEME_LIGHT` (false — dark only, d37_theme cleared). ui-e2e `flags` checks both off.
- Theme: dark tokens on `:root`, light on `:root[data-theme="light"]` (index.html; server pages — CSS in api/_lib/page.js). The head
  script (index.html == `THEME_HEAD` in page.js, ui-test compares) sets data-theme before first paint from localStorage `d37_theme`
  (auto | dark | light; default `D='dark'` — owner's choice, «Авто» = change D in both). ⚙️ «Сайт» → «Тема» = D37Settings `theme`
  (mirrors d37_theme; «↺ Сбросить всё» keeps it). Site shell colors — tokens only: `--text --muted --text-hi --card --panel --line`,
  veils `rgba(var(--fg-rgb),a)` (not rgba(255,255,255,a)), text colors `--accent-t --ok-t --gold-t --bad-t --tw-t` (light: AA ≥ 4.5 on
  every light surface incl. --bg2 — ui-test computes it). Light-only fixes — css/ui2.css. White stays white only on colored buttons/media.
- Dark islands (always dark tokens; their UI sits on dark canvases): `#gamesStage,.s3,.wld-edit,.ph,.pe,.pe-loading,.shorts-page` —
  one list (index.html twice + ui2.css `:not(:is(…) *)`, ui-test checks). New overlay drawn over a game → add it there.
  VIP accent as text in light → `--accent-ink` (profile.js accentInk, darkened until 4.5:1).
- Mini-card — ONE for the site: js/features/minicard.js `D37Mini.open(uid, { nick, anchor, actions, guest })` / `close()` / `isOpen()`
  (old name `openMiniProfile(id, nick, el)`). Opens from `data-mini-uid` (+ `data-mini-nick`) or `<a href="#/profile/<uuid>">`
  (UI_V2); `data-nomini` opts out. Buttons — pure `decide()` (privacy; D37Age: `kb` closes DM/calls, `kp` closes friendship and
  «📍 К нему»; ui-test). msgview `V.userCard` delegates (actions: report / mods / modDo / block). Phone — bottom sheet with its own
  history entry (Back closes); PC — popover kept on screen; Esc / outside click close. User text — textContent only. Speed: built
  hidden in idle time (warm-up layout), focus moves into it only for keyboard users (focus() forces a full style+layout — ≈12 ms on
  a phone ×4), character image cached per look. Not yet: the 3D/2D world cards (js/games/mir.js, world.js — API is ready).
- Profile 2.0: pf2Layout() moves the existing cards into two columns once (ids unchanged); header numbers come from return values of
  renderProfileXp / renderAchievements. Others' friend count is not shown (RLS returns only own friendships).
- Tests: ui-test (64), settings-test (theme part), `node scripts/ui-e2e.cjs perf|leak|cls|shots|flags|ci` (Chrome, phone CPU ×4).

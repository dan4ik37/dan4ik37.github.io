<!-- Moved verbatim from CLAUDE.md on 2026-10-28 (CLAUDE.md is now a short English index). Russian, as written then. When you change this area, rewrite the part you touch in short English. -->

## Прогрессия (progression.sql + economy.sql): уровни, ачивки, награды (экономика пересобрана 15.10.2026 — docs/ECONOMY.md)
- Числа наград — economy.sql (последним; переопределяет функции xp.sql, games.sql, progression.sql, secrets.sql, unity.sql; старые
  файлы НЕ перезапускаем — progression.sql пересоздал бы profiles_public). XP — `xp_rule()` ↔ `XP_NUM` в xp.js; лестница —
  `level_ladder()` ↔ `LEVEL_REWARDS`; ачивки — `achievement_xp`/`my_achievements` ↔ `ACHIEVEMENT_DEFS`. Сверка —
  `node scripts/economy-test.cjs` (620), расчёт по времени — `node scripts/economy-sim.cjs [--write]`. Меняешь одно — меняй другое.
- XP: визит 5, серия 7/30 — 25/100, чат 1 (до 15), форум 8 (до 3) / 2 (до 10), идея 3 (до 3) / сняли 50, приглашение 50, просмотр 3
  (до 10), задание дня 25, секреты 50, донат 1 XP/₽ (до 1000). Игры: `game_win_xp` 1…20 (games-more.sql); XP — первые 3 победы в день
  в ОДНОЙ игре (`game_family`: horde_duel → horde, pauk4 → pauk) и до 100 XP в день за все (`game_xp_award`; game_result отдаёт
  `xp_cap` 'game'|'day' — подсказка игроку); Unity — 5 XP, все Unity-игры — одна игра. Ачивки вдвое меньше (VIP и донат — как
  были); значки level_10/20/30/40/50/75/100 — без XP. user_visits — напрямую только сегодняшняя дата (серию не подделать).
- Лестница (уровень = floor(√(XP/50))+1): 5 неоновая рамка, заявки в друзья (15); 10 титул, след «Листопад»; 15 золотая рамка, 20
  друзей, 100 🪙; 20 Совёнок, «Бывалый», 25; 25 — 30, 150 🪙; 30 радужная рамка, 35, VIP на 3 дня; 35 медаль, 40; 40 золотой ник,
  «Мастер», 45; 45 «Снежинки», 300 🪙; 50 огненная рамка, VIP на неделю; 55 Волчонок, 400 🪙; 60 радужный ник навсегда; 65 шар,
  500 🪙; 70 «Кометы»; 75 «Живая легенда», 700 🪙; 80 Орёл; 90 «Галактика», 1000 🪙; 100 бриллиантовая рамка, «Бессмертный», VIP на
  месяц. VIP за уровень — только Bronze (vip_grants, после текущего VIP), Silver/Gold — только за поддержку (владелец: «а то так
  обанкрочусь»); старый VIP за 30/50/100 остаётся, пробный на тот же уровень не дают. Монеты за уровень — разово (coin_log 'level',
  ref lvN; кто уже выше — получит при следующем XP). Ник — `nick_fx()` (золото 40+, радуга 60+ или секреты) → secrets.js
  `.nick-gold`/`.nick-rainbow`. Друзья: 15 → +5 каждые 5 уровней с 15-го до 40-го (45); VIP 50/70/100; персонал без лимита (RLS на
  `friendships`). Уровень 10: титул (`user_titles`, RPC `set_title`; титул роли/VIP — только пока роль/VIP есть, `nick_extras`).
  Время (economy-sim; с 22.10 — с заданиями недели и сезоном): обычный игрок (30–45 мин/день) — 10 ур. за ~53 дня, 30 — ~19 мес,
  50 — ~4,7 года.
- VIP-уровень = max(донатный, за уровень): `vip_tier_of()` (её зовут has_perks, закреп, messages.vip_tier); `profiles_public` отдаёт
  эффективные `is_vip`/`vip_until` и `vip_tier` — клиент `getVipTier()` берёт `vip_tier`. VIP за уровень нельзя писать в profiles:
  триггер `protect_profile_columns` откатывает is_vip в клиентской сессии. Невидимка — с Silver VIP (`can_be_invisible`).
- Ачивки — разово (`claim_achievements()` при входе и на своём профиле, source `ach`), донаты — триггер на
  `vip_donation_log.matched`, source `donation`. Уведомления о порогах — `level_progress` + `notify()`.
- Рамки (лесенка): 5 неон · 15 золото · 30 радуга · 50 пламя · 100 бриллиант — `FRAME_LEVELS`/`avatarFrameClass` в xp.js, стили
  `.lv-frame-*` в premium.css (только CSS, без SQL), анимация — только в `body.high`. Подписи — LEVEL_REWARDS.

## Монеты 🪙, свой персонаж 🎭 и реклама за награду
- Кошелёк — `js/core/coins.js` (`D37Coins`): вошёл + coins.sql → база (coins_state, coins_run/ad/daily/buy/revive/import), иначе
  localStorage `d37_coins` с теми же лимитами; при входе гостевые монеты переносятся (до 1000, один раз). Купленное = база ∪ браузер.
  Цены/лимиты в трёх местах: coins.sql (coin_price, coin_run_cap, coins_*), coins.js (RULES, HERO/UP цены), avatar.js (PARTS).
- Числа монет (15.10.2026) — `coin_rule()` в coins.sql ↔ `RULES` в coins.js: бонус дня 20 (VIP ×2), задание дня 30, победа 3 (до 15 в
  день), забеги до 600 в день (раз в 20 с, VIP ×2), реклама 25 (до 6), «×2 за забег» 3 в день, перенос гостевых до 500, возрождение 30.
  `coin_run_cap` ↔ `RUN_CAP`: Орда 150, Башни 150, Блоки 80, косынка 20, паук 50, ячейка 15, сапёр 30, маджонг 20, судоку 30.
  Формулы: Орда — подбор (1/3/5, сундук 5) + 2 в минуту + 25 за победу; Башни 2 за волну + 25; Блоки очки/100; косынка 12/20, паук
  15/30/50, ячейка 15; сапёр 5/15/30; маджонг 3 + уровень; судоку 5/10/18/30, дня 20; Unity — половина просимого (до 25). Цены и
  обмен 💎→🪙 не меняли. Вещи «за уровень» — 7-е поле PARTS: цена 0, не продаются; `coin_level_item` (gen-skin-sql.mjs), char_save
  сверяет user_level (reason 'level'); coins_state отдаёт level → `D37Coins.level()`; гардеробы — «🔒 ур. N». Сейчас: следы Листопад
  10, Снежинки 45, Кометы 70, Галактика 90; питомцы Совёнок 20, Волчонок 55, Орёл 80; в руку Медаль 35, Хрустальный шар 65.
- Персонаж — `js/core/avatar.js` (`D37Char`): PARTS — 46 слотов. 7 «2D» (SLOTS2D: цвет, глаза, рот, шапка, предмет, питомец, след —
  рисуются кодом в 2D-играх, `sprite()` — кэш для игр, `img()` — для <img>) + 39 частей 3D-человечка (BODY_SLOTS, `body: 1`): фигура, кожа,
  рост/телосложение/голова ('0'…'4'), цвет глаз, брови, ресницы, щёчки, причёска и цвет волос, верх + отделка, низ, обувь, цвета шапки/
  очков/шеи/спины, очки, шея, спина; с 15.10.2026 (агент) — части тела как в Роблоксе: форма (psh голова, pst туловище, psal/psar руки,
  psll/pslr ноги) и цвет (pch, pct, pcal, pcar, pcll, pclr; палитра PCOL — кожа, зомби/пришелец/фея/металл, цвета Роблокса; «auto» — кожа у
  живой части, свой металл у брони), стиль лица face (аниме, классика, мультик, точки, кавай 150), на руках glove (напульсники 40,
  варежки 60, перчатки 80, часы 120, боксёрские 200) + glovec. Формы туловища/рук/ног — пакеты PACKS (Обычный, Классика, Стройный — 0;
  Силач 250, Робот 700, Рыцарь 900; у робота и рыцаря — и голова; голова «Кубик» 80): покупается пакет 'skin:pack:<id>' (buyItem(slot, id)
  — что купить), его части носятся вперемешку. Новой части нет в образе — PART_DEFAULT («как было до частей», НЕ по отпечатку ключа:
  старые образы выглядят так же; upgrade(look) — миграция). Остальные не выбранные части — по «отпечатку» ключа игрока (разная толпа).
- Палитра (`pal: 1`): кроме готовых — любой цвет, id «x» + 6 hex (xff8800), бесплатно (`D37Char.custom/nearest`). Обычные цвета
  бесплатны; за монеты — особые: одежда galaxy/gold/rainbow, кожа goldskin, глаза glow/fire, волосы neon/rainbow (VIP).
  «auto» в цветах аксессуаров = «как задумано» (у каждой вещи свой цвет).
- Вещи только за 💎 (6-е поле в PARTS): skin:hat:gemcrown 150, skin:back:gemwings 300, skin:trail:gems 100 — продаёт #/shop
  (premium_spend → coin_wallet.items); D37Char.price → цена в 💎, gemsOf(item) > 0; D37Coins.buy → 'gems', coins_buy — отказ, char_save
  надевает купленное (coin_gems_item). Новая такая вещь — PARTS + каталог магазина (premium.sql, premium.js, api/_lib/premium.js) + gen-skin-sql.
- Вещи-награды (8-е поле PARTS): 1 — за друзей (referrals2.sql), 2 — сезонный путь (вещь темы), 3 — новогоднее задание (⛄): цены нет
  (gen-skin-sql пропускает), сервер кладёт в coin_wallet.items, char_save надевает выданное; подписи — D37Char.grantOf (charedit, wardrobe).
- Надетое: coin_wallet.look (char_save проверяет владение; VIP-части — coin_vip_item; части пакета — по пакету), гостю — d37_char. Цены
  частей и пакетов, списки VIP и 💎, слоты char_save в coins.sql генерирует `node scripts/gen-skin-sql.mjs` из PARTS/PACKS (504 цены; тест
  PGlite сверяет цены, свои цвета, VIP, пакеты, 💎). Пока coins.sql в базе старый: saveLook (coins.js) сохраняет то, что сервер понимает
  (отвергнутую вещь за 💎 — без неё), fromServer (avatar.js) оставляет из браузера новые части и купленное за 💎, которых в базе нет.
- Гардероб #/games/wardrobe (`wardrobe.js`): есть WebGL → 3D-редактор `js/games/charedit.js` (`D37Editor.mount(el, {api, onClose, key})`):
  разделы Тело/Части/Лицо/Волосы/Одежда/Аксессуары/Питомец → вкладки → карточки с картинками (`preview.thumb`) и палитры (готовые +
  «🎨 свой»). «🦾 Части»: голова, туловище, каждая рука и нога — форма и цвет; нажал на часть на витрине (preview.onPick) — она открыта и
  подсвечена; «🪞 Зеркально» (d37_ce_mirror), «♻ Сбросить», «🎲 Случайно», «↩ Отменить» (до 40 шагов). Своё/бесплатное надевается сразу,
  платное — «Купить и надеть» (часть пакета — покупается пакет), за 💎 — ссылка в #/shop. Пока тянут палитру — только витрина (`recolor`),
  сохраняем после отпускания. Нет WebGL — 2D-гардероб (только SLOTS2D). Плашка «Мой персонаж» — `renderGamesMe` в games.js.
- 3D-человечек (js/games/world3d.js, kit): кости body → torso → headP → head; armL/armR (плечо) → elbowL/R → handL/R (предмет — в handR);
  legL/legR (бедро) → kneeL/R. Вещи садятся по форме частей. kit(T, { q }) — качество low/mid/high; build(look, key, { lod }) — дальний
  упрощённый; склейка bake — ~17–19 вызовов отрисовки на человечка (было 30–40). animate(ch, moving, dt, t, o): шаг/бег смешиваются, руки
  навстречу ногам, таз и плечи, колени и локти, приземление, плавание, лестница, паркур; 15 эмоций (World3D.EMOTES) с выражением лица
  (строится при первой эмоции); взгляд o.look; o.snap — поза без сглаживания (картинки, спрайты); o.land, o.blink; моргание —
  ch.faceSet.userData.eyes.scale.y (ch.eyes теперь []); без мусора за кадр. World3D.CHAR_VERSION (сейчас 2) — менять при любой правке
  вида или поз (сбрасывает кэш спрайтов). actors.js: дальше 30 ед. — упрощённый (ближе 24 — подробный), взгляд на камеру/соседа
  (a.lookAt — своя точка); NPC robot/knight — пакеты. Тест: `node scripts/char-test.cjs <three r149>` (5054: миграция, эталон старой
  версии scripts/char-ref.json — НЕ пересобирать, формы, LOD, анимации, мусор, цены и coins.sql, старый char_save).
- Реклама за награду — только РСЯ «Rewarded» или Google H5 Games Ads (`ADS_IDS.h5games`, отдельная заявка). Обычные блоки AdSense
  за награду показывать НЕЛЬЗЯ (бан). `D37Ads.rewardReady()/showReward(name)` → true только если досмотрел; кнопку «за рекламу»
  показывать, только когда rewardReady(); текст кнопки обязан говорить, что будет реклама и что дадут. `D37Ads.interstitial()` —
  полноэкранная между партиями (только телефон, не чаще 3 мин, не после первой партии).

## 💎 Кристаллы, магазин #/shop, оплата картой (premium.sql, api/pay.js; агент 15.10.2026)
- Кристаллы — отдельно от монет 🪙: только за деньги (карта Казахстана / Kaspi или донат DonationAlerts), тратятся только на
  сервере (premium_spend): VIP 1/3/12 мес — 100/270/960 💎, VIP в подарок по нику (100 💎, до 5 в сутки), обмен 💎→🪙 (10→100,
  50→550, 100→1200; обратно нельзя), эксклюзивы персонажа skin:hat:gemcrown 150 / skin:back:gemwings 300 / skin:trail:gems 100
  (в магазине видны, только когда avatar.js знает часть). Без лутбоксов. Пакеты 100/300/550/1200/2600 💎 = 100/300/500/1000/2000 ₽
  донатом = 590/1770/2950/5900/11800 ₸ картой (≈5,9 ₸ за ₽).
- Цифры в трёх местах: premium.sql (premium_packs, premium_items, premium_settings), js/core/premium.js (CFG — название и цены,
  D37Gems), api/_lib/premium.js (серверные страницы); scripts/pay-test.cjs и PGlite-тест сверяют.
- База: premium_wallet (баланс ≥ 0 + долг после возврата), premium_ledger (каждое изменение — строка), premium_orders,
  premium_payments ((провайдер, номер) — одно начисление), premium_settings (курс доната, бонус, лимиты 3000 ₽/сутки и
  10 000 ₽/30 дней, выключатель — меняет админ в магазине). Оплата → premium_credit (только service_role, после проверки подписи,
  сумма и валюта сверяются с заказом); возврат → premium_refund (потратил — долг). Покупки за деньги растят total_donated
  (уровень VIP) и XP, тестовые — нет. Заказ — только с галочкой «платит взрослый или разрешил» (дата первого согласия хранится).
- Донат (22.10, владелец: «просто будет донатер»): выключатель site_config 'donate_rewards' — 'off' (по умолчанию, строки нет):
  донат НЕ даёт VIP, 💎, XP (xp_on_donation) и 💎 пригласившему (ref_on_donation), а даёт статус «💛 Донатер» (ниже); 'vip' — как до
  22.10 (premium_wallet.donate_mode 'vip': 100 ₽ = месяц, или 'gems': 1 ₽ = 1 💎 + бонус); 'gems' — все донаты в 💎. Переключает
  админ: магазин → «🛠 Админ» → «💛 Что даёт донат» (donor_admin_set; на 'off' остатки vip_pending_rub → ⌈× 30 / 100⌉ дней VIP).
  credit_donation (6 параметров, + p_message) привязывает сам, только если имя не «аноним» (donor_name_reserved: регистр, ё, латиница-
  двойники), логин совпал, донат после регистрации и после reserved_donate_logins.reserved_at; иначе — hold (reserved / before_reg /
  before_login / no_profile / currency) + hold_profile + текст доната — админу. Анонимные (пустое имя) тоже пишутся — для цели.
- «💛 Донатер» (premium.sql раздел 6–8, js/core/premium.js D37Donor): уровень = сумма донатов reward 'status' за последние 30 дней
  (скользящее окно, считается при чтении — без расписаний; индекс idx_vip_donation_log_status), уровни donor_levels() = D37Donor.LEVELS
  = api/_lib/premium.js DONOR_LEVELS (I 100 / II 300 / III 700 / IV 1500 ₽ — владелец 22.10: «пока так»; pay-test сверяет), до
  какого числа — donor_status (until / until_any). Бонусы = VIP того же ранга (perk: bronze/silver/gold); лучшая ветка — perk_tier_of
  (has_perks, pin_own_message, can_be_invisible, can_send_friend_requests, friend_limit переопределены в premium.sql; клиент —
  getPerkTier / statusOf / hasPerks в profile.js, без рекламы — ad-places.js). Значки: чат (msgview .dn-badge → D37Donor.fill пачкой
  donor_badges, VIP-значок прячется, если статус не ниже), профиль, мини-профиль, топ донатеров (api/donations.js → donor_names_levels).
  Скрывшие донаты (privacy_hide_donations) — без значка для других. В играх бонус = без рекорда: подсказка «5 букв», 3-я+ отмена
  «2048», 4-й вариант «Орды». PGlite: E:\claude-tmp\donate\test-donor.mjs (96, с замером на 100 000 донатов: has_perks ≈ 0,8 мс).
- api/pay.js (одна функция; функций 10 из 12): ?a=config; ?a=order (Bearer-токен Supabase → /auth/v1/user, согласие взрослого);
  ?a=tiptop&n=check|pay|fail|refund — TipTop Pay (бывший CloudPayments Kazakhstan): HMAC-SHA256 base64 ключом API Secret, Vercel
  сам разбирает форму → проверка по X-Content-HMAC; формат уведомлений в кабинете — «TipTop Pay», не JSON; ?a=freedom — Freedom Pay:
  init_payment.php → переход, pg_sig = md5(«pay;значения по алфавиту;ключ»), ответ — подписанный XML. У Kaspi API для сайтов нет:
  KASPI_PAY_LINK + номер заказа D37-…, админ сверяет сумму/время и жмёт «✓ Оплачено». Адаптеры — api/_lib/pay.js.
- Env в Vercel: TIPTOP_PUBLIC_ID, TIPTOP_API_SECRET, FREEDOM_MERCHANT_ID, FREEDOM_SECRET_KEY, FREEDOM_TEST=1, KASPI_PAY_LINK,
  PAY_CURRENCY (KZT), PAY_DISABLED=1, PAY_CARDS=1 (+ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Нет ключей — способа нет; нет premium.sql — «скоро».
  22.10 («пока только Kaspi»): карты включаются только PAY_CARDS=1. Заказ — две галочки (взрослый разрешил + согласие на обработку
  данных, p_pd; /privacy#pay — место для юриста) и возраст premium_pay_age: до 14 — нельзя, год не указан — сначала указать, 14–17 —
  лимиты age_shop_caps. Функции магазина — только в premium.sql (копии из age.sql убраны). Цены окончательные («налоги включены»).
  Налог: premium_settings.tax_pct / tax_period (пусто — «не указано»), отчёт premium_admin_income (магазин → «🧾 Доход и налог», CSV).
- Магазин js/features/shop.js (#shop-page, PAGES.shop; shop.js грузится ДО router.js, иначе прямая ссылка /#/shop пустая): пакеты,
  «из России — донатом» (российские карты казахстанские эквайеры не принимают), что даёт донат, траты, история, блок для родителей,
  админ (найти, ±💎 с причиной, история, Kaspi «Оплачено», проблемные платежи, «Вернул деньги», настройки). #/shop/o/<заказ> —
  возврат со страницы оплаты. Баланс — #navGems в шапке (вошедшим, ≥641px), в профиле, на плашке «Мой персонаж».
- Страницы /shop, /terms, /refund, /contacts — api/pages.js (routes/shop.js, routes/legal.js; без рекламы). Реквизиты продавца —
  одно место api/_lib/seller.js ([…] — заглушка, на страницах «уточняется»). Тексты — шаблон, показать юристу. Пошагово владельцу
  (ИП на упрощёнке 910, счёт, касса/ОФД, провайдер, ключи, проверка, возвраты) — docs/PAYMENTS_SETUP.md.

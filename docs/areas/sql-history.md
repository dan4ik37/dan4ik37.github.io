<!-- Moved verbatim from CLAUDE.md on 2026-10-28 (CLAUDE.md is now a short English index). Russian, as written then. When you change this area, rewrite the part you touch in short English. -->

## Ожидает запуска владельцем (обновлять этот список!)
Проверено с сервера 22.10 утром: ПРИМЕНЕНЫ premium.sql (donor_levels, donor_me mode off, «Аноним» зарезервирован), age.sql + community.sql (kid_contact → auth, kidsafe_on → true, call_check → null, age_public_kids → 42501), games-more.sql (kletochki 4, chervyachki_online 6, quest_rule w_xp 5 / w_pts 40, weekly_quests, season_state), coins.sql (coin_run_cap kletochki/chervyachki 10). НЕ применён только ops.sql (п. 14). bases.sql / raids.sql — после слияния военных баз (T-013).
1–3. Экономика 15.10.2026 (docs/ECONOMY.md) — СТРОГО по порядку: 1) `games-more.sql` (ещё раз) — проверка
   `/rpc/game_win_xp` {"p_game":"horde"} → 10 (20 — старая версия), {"p_game":"fillword_daily"} → 6 (новые игры), {"p_game":"podzem_boss1"} → 6 («Подземье»), {"p_game":"kubomir"} → 4 («Кубомир»); 2) `coins.sql` (ещё раз) — `/rpc/coin_rule` {"p_key":"daily"} → 20
   (PGRST202 — не применён), `/rpc/coin_level_item` {"p_item":"skin:pet:owl"} → 20, `/rpc/coin_run_cap` {"p_game":"fillword"} → 15, {"p_game":"podzem"} → 20, {"p_game":"kubomir"} → 15;
   3) `economy.sql` (новый, ПОСЛЕДНИМ) —
   `/rpc/xp_rule` {"p_key":"visit"} → 5 (PGRST202 — не применён), `/rpc/achievement_xp` {"p_code":"creator"} → 250 (500 — старая).
   До запуска сервер считает по старым числам, подписи на сайте уже новые. Перезапустил xp.sql, games.sql, progression.sql,
   secrets.sql или unity.sql — после них снова economy.sql. Тесты PGlite: pg/eco/test-economy.mjs (86), pg/eco/test-coins-eco.mjs.
4. `ads.sql` (15.10.2026) — реклама за 💎, кабинет рекламодателя #/adv (ad_settings, ad_campaigns, ad_creatives, ad_stats, ad_seen,
   ad_log, ad_reports, ad_advertisers; ad_prices / ad_live / ad_pick / ad_view / ad_go (только service_role) / ad_save / ad_act / ad_my
   / ad_get / ad_terms_accept / ad_report / ad_admin_*; закрытое хранилище ads). Нужен premium.sql (применён); от age.sql и
   economy.sql не зависит. Проверка: `/rpc/ad_prices` гостем → {"enabled":true,…}, `/rpc/ad_live` → {"on":true,"f":{}}, `/rpc/ad_go`
   гостем → отказ в правах (PGRST202 = не применён). До запуска кабинет пишет «откроется, когда сайт обновится». PGlite: 259 (pg/test-ads.mjs).
5. `auth-links.sql` (15.10.2026) — вход через VK ID / Яндекс ID / Telegram и защита всех входов: auth_links, auth_link_bans, auth_ip_log,
   auth_once, auth_link_intents, auth_secret; auth_social_begin/bind, auth_link_add, auth_login_methods, auth_link_remove/hide/intent,
   auth_links_staff; триггеры на banned_nicks и auth.identities. Нужны только profiles, banned_nicks, pgcrypto. Проверка:
   `/rpc/auth_login_methods` гостем {} → {"ok":false,"reason":"auth"} (PGRST202 = не применён). До запуска кнопок VK/Яндекс/Telegram нет.
   «Allow manual linking» в Supabase включать ТОЛЬКО после этого файла. PGlite: 130 (pg/test-authlinks.mjs).
6. `referrals2.sql` (15.10.2026) — «Приглашения 2.0» (ref_codes, ref_links, ref_marks, ref_payouts, ref_secret; ref_claim / ref_ping /
   ref_me / ref_set / ref_public / ref_top / ref_frames / ref_admin_*; триггеры на profiles, level_progress, premium_ledger,
   vip_donation_log). После economy.sql (можно и без него). Проверка: `/rpc/ref_rule` гостем {"p_key":"pct"} → 10 (PGRST202 = не
   применён); `/rpc/ref_public` гостем {"p_code":"zzzzzz"} → {"ok":false,"reason":"not_found"}. До запуска: ссылка — старая ?ref=<ник>,
   «награды появятся, когда сайт обновится». Перезапустил referrals.sql, xp.sql или notifications.sql — потом снова referrals2.sql.
   PGlite: 168 (pg/test-referrals2.mjs).
7–8. Военные базы и набеги (T-013, 22.10.2026; можно давать владельцу): 7) `bases.sql` — ЕЩЁ РАЗ (район мирный, оборона/казарма/армия
   района → кирпичи на том же участке; военные базы war_*). Проверка: `/rpc/war_state` гостем → {"ok":false,"reason":"auth"} (PGRST202 = не
   применён), `/rpc/war_sector` {"p_sector":0} → {"ok":true,…,"bases":[]}; 8) `raids.sql` — ПОСЛЕ bases.sql и premium.sql (набеги на базы):
   `/rpc/raid_state` гостем → {"ok":false,"reason":"auth"}, `/rpc/raid_top` {"p_kind":"all"} → [], `/rpc/raid_settle` гостем → отказ в правах.
   До запуска: базу не основать («откроются, когда сайт обновится»), «Набеги» — учебный и дружеский бой. PGlite (E:\claude-tmp\bases\pg):
   test-bases.mjs (104), test-raids.mjs (114).
9. ПРИМЕНЁН 22.10.2026 (проверено с сервера: cm_modlog → rights, cm_automod_get → can false, chat_channels.archived/category_id → 200, cm_layout → 42501; старое — cm_roles private, cm_events ok, cm_invite_info null, news mods_only) — `community.sql` (ЕЩЁ РАЗ, 21.10.2026) — теперь ВЕСЬ SQL чата и сообществ в одном файле: community2.sql и community3.sql в него
   СЛИТЫ (части 2 и 3; отдельных файлов больше нет, оба уже были применены) + новая часть 4: папки и порядок каналов, тема, архив, «кто
   пишет», модерация с причиной (предупреждение, тайм-аут, удалить N последних, кик, бан), журнал модерации, автомодерация, уведомления
   сервера (все / @ / ничего, заглушить сервер или канал). Идемпотентно, безопасно поверх уже применённых старых трёх (данные не трогает —
   PGlite: и на чистой базе дважды, и поверх старых трёх файлов с данными). Нужен premium.sql (применён).
   Проверка гостем (publishable-ключ; PGRST202 = функции нет, файл не применён):
   `/rpc/cm_modlog` {"p_community":null} → {"ok":false,"reason":"rights"};
   `/rpc/cm_automod_get` {"p_community":null} → {"ok":true,"can":false,"cfg":{}};
   `/rest/v1/chat_channels?select=id,archived,category_id&limit=1` → 200 (400 «does not exist» = не применён);
   `/rpc/cm_layout` {"p_community":null,"p_cats":[],"p_chans":[]} → 401 permission denied (только вошедшим — права на месте).
   Старое должно остаться как было: `/rpc/cm_roles` {"p_id":0} → {"ok":false,"reason":"private"}; `/rpc/cm_events` {"p_community":null} →
   {"ok":true,"can":false,"list":[…]}; `/rpc/cm_invite_info` {"p_code":"x"} → null; `/rest/v1/chat_channels?id=eq.news` → […"mods_only":true].
   До запуска сайт работает по-старому: каналы без папок, у модераторов старые кнопки (без причины), «🛡 Модерация» → «появится, когда сайт
   обновится». После запуска автомодерация включена сразу (все правила; выключаются в «🛡 Модерация → 🤖 Автомод»).
   При слиянии 21.10 поправлено: ссылки на сам сайт (dan4ik37.vercel.app / github.io, с https и без) можно всем — и новичкам, и
   гостям (позвать в игру); чужие — новичкам (меньше 3 дней на сайте / суток в сообществе) нельзя, в сообществах — никому (как было);
   comm_has_link ловит и чужие .app; фильтр мата comm_bad не ловит «страхует», «застрахуй», «педикюр» («ху…» — только с начала
   слова или после приставки). PGlite: E:\claude-tmp\community2\test-community.mjs (собирает gen-test.mjs из test-community.tpl.mjs) — 1034.
   PGlite: E:\claude-tmp\community2\test-community.mjs (1024 — части 1–4 × 2 базы).
10. `premium.sql` (ЕЩЁ РАЗ, 22.10.2026) — донаты → статус «💛 Донатер» (без VIP/💎/XP за донат; выключатель site_config
   'donate_rewards'), привязка донатов без абуза, оплата только Kaspi + согласие на данные + возраст с 14, налог и «🧾 Доход».
   Один файл, идемпотентно (PGlite: на чистой базе дважды и поверх старых premium.sql + age.sql — E:\claude-tmp\donate\test-donor.mjs,
   96; test-referrals2.mjs — 169). При запуске сам переведёт остатки vip_pending_rub в дни VIP. progression.sql / referrals2.sql /
   age.sql тоже менялись, но перезапускать их НЕ нужно (те же функции — в premium.sql). Проверка гостем (PGRST202 = не применён):
   `/rpc/donor_levels` → [{"lv":1,"min":100,"perk":"bronze"},…]; `/rpc/donor_me` {} → {"ok":false,"reason":"auth","mode":"off",…};
   `/rpc/donor_name_reserved` {"t":"Аноним"} → true; `/rest/v1/vip_donation_log?select=reward,excluded,hold,message&limit=0` → 200
   (400 «does not exist» = не применён); `/rpc/premium_state` → в ответе "donate_rewards":"off". До запуска сайт показывает старые
   тексты (VIP за донат) — так и работает сервер.
11. `games-more.sql` и `coins.sql` — ЕЩЁ РАЗ, по порядку (22.10.2026, io-игры «Клеточки» и «Червячки»; оба файла идемпотентны,
   от остальных не зависят). Проверка гостем: `/rpc/game_win_xp` {"p_game":"kletochki"} → 4, {"p_game":"chervyachki_online"} → 6
   (0 — старая версия); `/rpc/coin_run_cap` {"p_game":"kletochki"} → 10, {"p_game":"chervyachki"} → 10 (null — старая). До запуска игры
   работают, только без XP, таблицы рекордов и монет за них (рекорд — в браузере).
12. Безопасность детей (T-010, 22.10.2026), ПОСЛЕ premium.sql (п. 10), строго по порядку: 1) `age.sql` (ещё раз) 2) `community.sql`
   (ещё раз; без нового age.sql он сам откажет: «Сначала запусти age.sql…», ничего не применится). Выключатель — site_config 'kidsafe'
   ('off' — как раньше; строки нет — включено). Проверка гостем (PGRST202 = не применён): `/rpc/kid_contact` {"p_ids":[]} →
   {"ok":false,"reason":"auth"} и `/rpc/kidsafe_on` → true (age.sql); `/rpc/age_public_kids` {"p_ids":[]} → 401 (есть, только серверу);
   `/rpc/call_check` {"p_code":"abcdefgh","p_pass":"x","p_pub":"y"} → null, `/rpc/call_pass` {"p_code":"abcdefgh","p_pub":"x"} → 401
   (community.sql ч. 5). До запуска: звонки — как раньше (без пропуска), ники на /forum — как раньше, до 9 — «только читать» только в
   браузере. PGlite: E:\claude-tmp\kidsafe\test-kidsafe.mjs (441), test-community-ks.mjs (1034), test-donor.mjs (94).
13. `games-more.sql` — ЕЩЁ РАЗ (22.10.2026, T-015/T-024): задания недели, бесплатный сезонный путь, награды новогоднего задания
   (таблицы weekly_claims, season_progress, season_owned, season_frame, advent_log; триггеры на game_log и xp_ledger). Идемпотентно;
   нужны применённые games.sql, coins.sql, economy.sql, progression.sql, notifications.sql (всё есть). Вместе с п. 11 — один запуск
   games-more.sql, потом coins.sql. Проверка гостем (PGRST202 = не применён): `/rpc/quest_rule` {"p_key":"w_pts"} → 40;
   `/rpc/weekly_quests` → {"auth":false,"list":[…6 заданий…],…}; `/rpc/season_state` → {"auth":false,"no":0,"theme":"oct",…} (с 1 ноября —
   "no":1,"theme":"nov"); `/rest/v1/season_progress?select=pts&limit=0` → 200 (400 «does not exist» — не применён); `/rpc/advent_claim`
   {"p_day":1} → 401 (только вошедшим). До запуска карточек сезона и заданий недели нет (скрыты), новогоднее задание — без наград.
   PGlite: E:\claude-tmp\quests\test-quests.mjs (на чистой базе дважды — 117, поверх файлов из main с данными — 119, EXPLAIN — 10).
14. `ops.sql` (НОВЫЙ, 22.10.2026, T-016; от других файлов не зависит) — мониторинг ошибок сайта: ops_err, ops_err_day, ops_quota,
   ops_err_ingest (только сервер), ops_err_admin / ops_err_act (только админ). Проверка гостем (PGRST202 = не применён):
   `/rpc/ops_err_admin` {"p_days":7} и `/rpc/ops_err_ingest` {"p_items":[]} → 401, 42501 permission denied for function;
   `/rest/v1/ops_err?select=k&limit=1` → 401, 42501 permission denied for table. До запуска сайт работает как раньше: браузеры шлют отчёты на
   /api/diag, сервер тихо отвечает «молчи» (stop), окно «🩺 Ошибки сайта» пишет «выполни ops.sql». PGlite: scripts/ops-sql-test.mjs (73).
   Ещё владельцу (не SQL): копии базы на ПК — docs/BACKUPS.md (строка подключения, pg_dump, расписание; ключи и пароль вводит только он).
15. `city.sql` (НОВЫЙ, 22.10.2026, T-032 «Живой город» P1; нужны profiles, banned_nicks, age.sql — всё применено; от остальных не зависит) —
   денки 💵 в городах «Мира Денчика»: city_cfg, city_bank, cities, city_people, city_ledger, city_contrib, city_marks, city_days;
   city_defs / city_public (всем), city_state / city_act / city_admin (вошедшим). Проверка гостем (PGRST202 = не применён):
   `/rpc/city_defs` → {"v":1,…,"profs":{…},"rate":{"min":10,"days":1},…}; `/rpc/city_public` {"p_city":"kids"} → {"ok":true,"city":"kids",
   "treasury":5000,…,"rate":100} (в день запуска; со следующего дня + эмиссия); `/rpc/city_state` {} и `/rpc/city_act` {"p_act":"job"} → 401, 42501 permission
   denied for function; `/rest/v1/city_people?select=cash&limit=1` → 401, 42501 permission denied for table. До запуска в городах — «🧪 пробные
   денки» (в браузере) и «Банк города появится, когда сайт обновится». Числа — docs/CITY_ECONOMY.md, менять — «🏙️ Экономика города» (админ).
   PGlite: scripts/city-sql-test.mjs (134).
16. `ugc.sql` — ЕЩЁ РАЗ (22.10.2026, T-019: облачные сохранения «Кубомира» — раздел «☁️» в конце файла; весь файл идемпотентен). Проверка гостем (PGRST202/PGRST205 = не применён): `/rpc/cloud_rule` {"p_key":"slots"} → 2; `/rpc/cloud_list` {"p_game":"kubomir"} → {"ok":false,"reason":"auth"}; `/rpc/cloud_usage` {} → 401 permission denied; `/rest/v1/cloud_saves?select=world&limit=0` → 200. До запуска: «Облако сейчас недоступно — миры сохраняются в браузере». Числа (2 мира × 2 МБ, VIP/Донатер 4 × 4 МБ) — предложение, решает владелец. PGlite: E:\claude-tmp\coop\test-cloud.mjs (64).
17. `evo.sql` (НОВЫЙ, 22.10.2026, T-056 «Путь клетки»; нужны только profiles, banned_nicks; от остальных не зависит) — род игрока: evo_lineage,
   evo_cfg, evo_days; evo_defs (всем), evo_state / evo_act / evo_admin (вошедшим). Проверка гостем (PGRST202 = не применён): `/rpc/evo_defs` →
   {"v":1,"slots":6,"parts":[…],…}; `/rpc/evo_state` {} и `/rpc/evo_act` {"p_act":"start","p_a":{}} → 401, 42501 permission denied for function;
   `/rest/v1/evo_lineage?select=dna&limit=1` → 401, 42501 permission denied for table. До запуска вошедшим — «🧪 пробный род» в браузере и «Сохранение
   рода на сервере появится, когда сайт обновится»; «🌱 На сушу» — только после запуска (пробный род переносится один раз, до «Колонии»).
   PGlite: scripts/evo-sql-test.mjs (88: JS = SQL на 900 случайных ходах).
18. `planet.sql` (НОВЫЙ, 22.10.2026, T-079 — часы мира; от других файлов не зависит; дальше в него допишут части планет и космоса). Проверка гостем: POST `/rpc/world_now` {} → число около «сейчас» в мс (в октябре 2026 ≈ 1,79·10¹²); PGRST202 / 404 = не применён. До запуска небо и орбиты на /play/planet идут по часам устройства (окно «🪐 Система» пишет «planet.sql ещё не запущен»). PGlite: scripts/planet-sql-test.mjs (8).
Проверено с сервера 22.10 днём: ops.sql ПРИМЕНЁН (ops_err_admin → 42501); city.sql и ugc.sql (облако) — ещё нет. Вечером 22.10 (с сервера): НЕ применены bases.sql (новая, war_state — PGRST202), raids.sql (raid_state — PGRST202), city.sql, ugc.sql (cloud_rule), evo.sql, planet.sql (world_now) — владельцу дан список по порядку: bases → raids → city → ugc → evo → planet. ПРИМЕНЕНЫ ВСЕ ШЕСТЬ (проверено с сервера 22.10 вечером, после «скл всё»): war_state → auth, war_sector → ok/bases [], raid_state → auth, raid_top → [], city_defs → v 1, city_public kids → ok, city_state → 42501, cloud_rule slots → 2, cloud_list → auth, cloud_saves гостем → 42501 (так и задумано: revoke от anon), evo_defs → v 1, evo_state → 42501, world_now → число. Ждёт запуска — ничего.
Проверено с сервера 15.10.2026 вечером: ПРИМЕНЕНЫ games-more.sql (horde 10, kubomir 4), coins.sql (coin_rule daily 20,
kubomir 15), referrals2.sql (ref_rule pct 10), ads.sql (ad_prices, ad_live), auth-links.sql (auth_login_methods → auth).
НЕ применён economy.sql (xp_rule — PGRST202, achievement_xp creator = 500) — владельцу запустить ещё раз и прислать ошибку.
16.10 (слияние мира, GAMES_VER 92): games-more.sql и coins.sql снова ИЗМЕНЕНЫ — ключи mirwar (game_score_cap 200, game_win_xp 3;
coin_run_cap 20) и rp (coin_run_cap 10). Владельцу ЕЩЁ РАЗ, по порядку: games-more.sql → coins.sql → economy.sql. Проверка:
`/rpc/game_win_xp` {"p_game":"mirwar"} → 3; `/rpc/coin_run_cap` {"p_game":"mirwar"} → 20, {"p_game":"rp"} → 10; economy — как выше.
До запуска работы в городе и бои зоны не дают монет и XP (ошибок игрок не видит).
Проверено с сервера 16.10: economy.sql ПРИМЕНЁН (xp_rule visit → 5, achievement_xp creator → 250). games-more.sql и coins.sql —
прошлые версии (game_win_xp mirwar → 0, coin_run_cap mirwar / rp → null): владельцу ещё раз ТОЛЬКО games-more.sql → coins.sql
(свежие файлы отправлены 16.10); economy.sql после них НЕ нужен — общих функций у трёх файлов нет (проверено).
Проверено с сервера 16.10 вечером: ПРИМЕНЕНЫ community2.sql (messages.is_sticker есть → чат снова принимает сообщения;
chat_channels news, cm_events, cm_catalog), games-more.sql (game_win_xp mirwar → 3), coins.sql (coin_run_cap mirwar 20, rp 10).
НЕ применён только community3.sql (cm_roles / cm_boost_info — PGRST202; файл отправлен 16.10 позже остальных).
Позже 16.10: community3.sql ПРИМЕНЁН (cm_roles гостем → private, cm_boost_info → not_found, cm_boost_buy → 42501). Теперь применено ВСЁ,
кроме bases.sql / raids.sql (их ещё не давали — набеги переезжают в военные базы, п. 31). Чат: последнее сообщение всё ещё 20.09 —
владелец должен написать одно сообщение в #общий, проверить запросом messages order=created_at.desc.
Раньше (13:05 UTC): 1–8 ещё НЕ применены (game_win_xp(horde) = 20, остальные — PGRST202). 7–8 (bases.sql,
raids.sql) — давать владельцу только после того, как агент набегов закончит переделку (3D, большие базы): файлы ещё меняются
(22.10: переделка в военные базы готова — T-013, см. п. 7–8 выше).
age.sql применён 15.10.2026 (проверено: my_age_group гостем → reason auth, ugc_games/unity_games.age_rating → 200). Владелец: «остальные
поменять пока не могу» — напоминать 1–4 списком. premium.sql, coins.sql (части тела), community.sql применены 15.10.2026 (проверено с сервера: premium_state гостем → reason auth,
premium_credit гостем → 42501, coin_price(skin:pack:robot) = 700, coin_price(skin:hat:gemcrown) = null (только за 💎),
cm_invite_info → null, chat_info → каналы general/games/lfg/memes/voice, messages.channel/reply_to/edited_at → 200).
Если перезапускать server-hardening.sql или vip-claims.sql — после них снова premium.sql (он переопределяет credit_donation и
apply_unmatched_donation).
Применены (проверено с сервера 15.10.2026, самые свежие версии): world.sql (`/rpc/world_check` гостем {"p_pass":"x","p_pub":"y"}
→ null), coins.sql (`/rpc/coin_price` {"p_item":"skin:hair:afro"} → 150), ugc.sql (`/rpc/ugc_play` {"p_id":"x"} → not_found,
`/rpc/ugc_model_save` гостем {"p_id":"abcdef","p_name":"x","p_tris":1,"p_bytes":1} → reason auth), unity.sql (`/rpc/unity_play`
{"p_id":"x"} → not_found), bases.sql (`/rpc/base_street` {"p_street":0} → ok; участок №1 уже занял владелец).
PGRST202 в ответе = функции нет, файл не применён.
Новые ключи игр / цены монет — дописывать в games-more.sql / coins.sql (оба идемпотентны) и выдать владельцу «запусти ещё раз».
coins.sql и games-more.sql применены 10.10.2026 (проверено с сервера: coins_state гостем → auth, daily_top → [],
game_score_cap('sudoku_daily') = 1200, coin_run_cap('sudoku') = 60 — то есть самая свежая версия обоих файлов).
push-words.sql применён 10.10.2026 (проверено: push_set_words → 200 null, подписки гостю — []).
vip-claims.sql применён 09.10.2026 (проверено: claim_donation гостю → 42501, admin_* → «Только для админа»).
secrets.sql, games.sql, progression.sql применены (03.10.2026, проверено с сервера).

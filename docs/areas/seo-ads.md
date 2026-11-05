<!-- Moved verbatim from CLAUDE.md on 2026-10-28 (CLAUDE.md is now a short English index). Russian, as written then. When you change this area, rewrite the part you touch in short English. -->

## Поиск: что сделано и что дальше
- Google Search Console (владелец вошёл во встроенном браузере 09.10.2026): 0 проиндексировано, главная «URL неизвестен Google».
  09.10 отправлен /sitemap-pages.xml; «Запросить индексирование» — «квота превышена». **Следующая сессия:** запросить
  индексирование /, /about, /games, /tools/fonts, /tools/nick, /tools/cps, /games/words (≈10 в день).
- IndexNow (Яндекс, Bing → и поиск ChatGPT): ключ — файл `/351f920e862a819020eb7eb5ea035ac2.txt` (НЕ удалять),
  `api/_lib/indexnow.js`; новые ролики — автоматически из push-check; все страницы — `node scripts/indexnow.mjs [pages|videos|all]`
  (09.10 отправлены все 6073; 15.10 — pages: новые игры, магазин, /terms /refund /contacts — 200/202). Не чаще раза в несколько
  дней целиком.
- Ник по-русски — «Денчик37» (так хочет владелец), не «Данчик37».
- «Кто такой dan4ik37» — `/about` (api/_lib/routes/about.js): только настоящие данные (YouTube + список роликов). Личных фактов
  (имя, возраст, город) нет — добавлять, только если владелец сам даст. `/llms.txt` — справка для ИИ.
- Главное для выхода в поиск — внешние ссылки: владельцу добавить dan4ik37.vercel.app в описание YouTube, Twitch, ВК, Telegram.

## Идеи на следующую сессию (с прицелом на деньги)
- **Реклама**: владельцу зарегистрироваться в РСЯ (partner.yandex.ru), вписать номера блоков в `ADS_IDS`.
- **AdSense**: блоки созданы (02.10.2026), номера вписаны. dan4ik37.vercel.app добавлен, на 10.10.2026 — «Выполняется проверка»,
  ads.txt — «Разрешено». Платёжные данные — владельцу (нужны только для выплат).

## AdSense status and ad rules (05.11.2026, branch ads-fix)
- Status: 28.10 AdSense rejected the site, «Обнаружены нарушения правил» (api/_lib/yt.js note; gambling promo codes in 562 videos,
  fixed in a2b30cd). Since 26.10 the site row says «Требуется действие». The exact policy name and example URLs were never written
  down: the owner reads AdSense → «Сайты» and «Политики» and sends screenshots; then replace this line with the real reason.
- Ads only on screens with our own content: /games, /games/<id>, /tools/*, /quiz*, the home page, after-round under a game.
  No ads: /v/<id> unless the description has >= 150 words of the author's own text (yt.js ownWords; 1 of 3799 today), 16+/18+ videos,
  video lists /videos /top /topics /topic/<slug> /history (page.js VIDEO_LIST_ADS = false), every noindex page (404, 503).
- Google never on loading screens, «☕ Перерыв», the sticky rail, under the chat player, in the Studio 3D compile card
  (ad-places.js ADS_RULES.gStrict). The Google after-round unit is one per game screen and is removed as soon as play resumes.
  No ads inside the «game over the world» window (mir-play.js P.ad). Rollback: each flag = one line.
- GGDROP banner on streams May 2025 - Jan 2026: every video of that window is hidden (yt.js HIDE_GG_WINDOW, GG_WINDOW).
- Shorts: /v/<id> noindex, not in sitemap-videos (2651 long videos left). App routes /donate /lfg /soundboard /poll /clicker are
  not in sitemap-pages (the server returns the home HTML there). /play/* — X-Robots-Tag noindex; /index.html → / (308).
- Round 2 (05.11): home video grid has no network/direct ads between YouTube cards, own promo cards only (ad-places.js
  ADS_RULES.videoFeed = false). Unfilled / blocked Google units never shift the page: below the screen the slot is removed, on or above
  the screen it becomes own promo of the same height (ADS_RULES.settle, guard() watches data-ad-status, adsbygoogle.loaded and the
  adblock stub); server slots are inserted only while still below the screen (lazyBelow). No after-round unit while fullscreen.
  Share landings with own content (/tools/cps?s= without a nick, /tools/typing?s=, /quiz/<slug>?r=) are noindex but keep ads
  (page.js share, SHARE_ADS). /terms and /refund: no «Документ готовится», noindex + not in sitemap until seller.js is filled.
  trademarks.js covers Windows, Block Blast, 1010!, Ludo King, UNO, Wordle, GTA, Mario, Unity (whole page text). YouTube snapshot
  refreshed 2026-11-05 (rerun scripts/snapshot-uploads.mjs at least every 30 days). Watch achievements hidden (XP_WATCH).
- Owner-only (AdSense UI): Auto ads off or page exclusions (/play, /chat, /phone, /profile, /adv, /invite), EEA consent message,
  blocking controls (gambling, dating, alcohol), «Запросить проверку» after deploy; GitHub Pages mirror off (Settings → Pages).

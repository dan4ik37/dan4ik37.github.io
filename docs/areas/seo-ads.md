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
- Canonical of the static SPA pages (11.11): index.html is one file for `/`, /chat, /shorts…, so it carries NO static
  `<link rel="canonical">` (it would point /chat and /shorts at the home page until JS runs). The three SPA addresses in
  sitemap-pages (`/`, /shorts, /chat) get it as an HTTP header `Link: <…>; rel="canonical"` (vercel.json headers, exact paths);
  router.js still sets the tag + og:url after JS. Adding an SPA address to the sitemap → add its Link header too.
- Round 2 (05.11): home video grid has no network/direct ads between YouTube cards, own promo cards only (ad-places.js
  ADS_RULES.videoFeed = false). Unfilled / blocked Google units never shift the page: below the screen the slot is removed, on or above
  the screen it becomes own promo of the same height (ADS_RULES.settle, guard() watches data-ad-status, adsbygoogle.loaded and the
  adblock stub); server slots are inserted only while still below the screen (lazyBelow). No after-round unit while fullscreen.
  Share landings with own content (/tools/cps?s= without a nick, /tools/typing?s=, /quiz/<slug>?r=) are noindex but keep ads
  (page.js share, SHARE_ADS). /terms and /refund: no «Документ готовится», noindex + not in sitemap until seller.js is filled.
  trademarks.js covers Windows, Block Blast, 1010!, Ludo King, UNO, Wordle, GTA, Mario, Unity (whole page text). YouTube snapshot
  refreshed 2026-11-05 (rerun scripts/snapshot-uploads.mjs at least every 30 days). Watch achievements hidden (XP_WATCH).
- Round 3 (05.11, branch ads-fix3): first-screen server slots are reserved while the page parses (page.js SLOT_RSV: an inline
  script right after `<div data-ad>` gives it the label + 280/300 px box before the text below exists; VIP via d37_noads — no
  reserve) and ad-places.js slot() fills a reserved slot at once (empty → own promo of the same height; ad scripts blocked → own
  link after load + 2 s). /tools/cps keeps the slot 150 px below the click pad. The after-round #gamesAd box is reserved from the
  first input in the game (RULES.roundHold; input-driven shifts are not CLS) and the ad goes into the same box. Games hub, Studio
  and Unity after-round units go through D37AdPlaces (slot / show → guard / settle). /ads-terms: no «шаблон… после регистрации ИП»
  line, noindex until seller.js is filled (legal.js DRAFT_NOTE / DRAFT_NOINDEX). /games/<id>?s=&n= challenge links: noindex; nick
  from the URL → no ads, without a nick → ads (SHARE_ADS). Watch achievements are not offered or shown as a title (achShown).
- Owner-only (AdSense UI): Auto ads off or page exclusions (/play, /chat, /phone, /profile, /adv, /invite), EEA consent message,
  blocking controls (gambling, dating, alcohol), «Запросить проверку» after deploy; GitHub Pages mirror off (Settings → Pages).

## Trust pages (14.11.2026, branch ads-about-trust; AdSense «Бесполезный контент»)
- Every server page footer starts with page.js TRUST_LINKS (О сайте и авторе, /sitemap, DEVLOG_URL = '/devlog' from branch ads-devlog — change
  or blank it there, Контакты, /privacy, /privacy#ads «Реклама и cookie»); index.html footer, privacy.html and 404.html carry the same links.
- /sitemap — HTML site map (routes/sitemap-page.js, no ads, in sitemap-pages.xml): same addresses as sitemap-pages.xml minus single forum
  posts / ideas / player games. New indexable section → a line there too.
- /about: sections «Что за сайт», «Как сделаны игры и инструменты», «Модерация и защита детей», «Как связаться» — facts only (age.sql,
  community automod, ugc/forum review, score caps, ADS_RULES.age). Organization + WebSite JSON-LD with shared @id (#org, #website,
  #person): page.js SITE_LD, the same block in index.html <head>. /contacts without seller data: title «Контакты сайта», general contact first.


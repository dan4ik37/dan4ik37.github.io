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
  fixed in a2b30cd). Since 26.10 the site row says «Требуется действие». Real reason (owner's screenshot 14.11): «Ваш сайт не готов к
  показу рекламы» → «Обнаружены нарушения правил» → «Бесполезный контент» (low-value content; ownership confirmed). Google judges the
  whole site: the sitemaps handed it 2808 URLs, 2651 of them /v/<id> with only a copy of the YouTube description, plus video lists.
- Index diet (14.11, branch ads-index-diet; api/_lib/page.js INDEX_DIET, rollback = false + remove the shell X-Robots-Tag blocks in
  vercel.json): thin pages stay reachable (200) but answer noindex (follow) and are out of the sitemaps — /v/<id> without >= 150 own
  words (yt.js ownWords; video-snap.js snapIndexable), /videos /top /topics /topic/<slug> /history, /ideas and /ideas/<id>,
  /forum/t/<tag>, forum articles under FORUM_MIN_CHARS (1000 chars ~ 150 words), /forum itself while < 3 such articles, player games
  /g/<id>; SPA shells /chat /profile /phone /shorts /invite /adv /donate /poll /soundboard /clicker /lfg /app /hub (+ sub-paths, /photo/*,
  /shop/*) via X-Robots-Tag in vercel.json and router.js NOINDEX. Sitemaps: 157 + 2651 = 2808 URLs → 102 + 1 = 103. Kept: /, /about,
  /games + 75 /games/<id>, /tools/* (7), /quiz + 10 tests, /studio, /vip, /reklama, /privacy, /contacts (+ /shop, /terms, /refund
  when live; forum articles with real text; the devlog when it lands — add it to sitemap-pages). The videos sitemap leaves the index
  when no video qualifies. Check: `node scripts/index-diet.mjs [--prod] [--list]` (renders every sitemap URL, fails on a noindex /
  non-200 URL in a sitemap or an indexable thin page). Then the owner presses «Запросить проверку» (owner only).
- Ads only on screens with our own content: /games, /games/<id>, /tools/*, /quiz*, the home page, after-round under a game.
  No ads: /v/<id> unless the description has >= 150 words of the author's own text (yt.js ownWords; 1 of 3799 today), 16+/18+ videos,
  video lists /videos /top /topics /topic/<slug> /history (page.js VIDEO_LIST_ADS = false), every noindex page (404, 503).
- Google never on loading screens, «☕ Перерыв», the sticky rail, under the chat player, in the Studio 3D compile card
  (ad-places.js ADS_RULES.gStrict). The Google after-round unit is one per game screen and is removed as soon as play resumes.
  No ads inside the «game over the world» window (mir-play.js P.ad). Rollback: each flag = one line.
- GGDROP banner on streams May 2025 - Jan 2026: every video of that window is hidden (yt.js HIDE_GG_WINDOW, GG_WINDOW).
- Shorts: /v/<id> noindex, not in sitemap-videos (since 14.11 long videos too unless they have own text — index diet above). App routes /donate /lfg /soundboard /poll /clicker are
  not in sitemap-pages (the server returns the home HTML there). /play/* — X-Robots-Tag noindex; /index.html → / (308).
- Canonical of the static SPA pages (11.11): index.html is one file for `/`, /chat, /shorts…, so it carries NO static
  `<link rel="canonical">` (it would point /chat and /shorts at the home page until JS runs). The SPA addresses in sitemap-pages
  get it as an HTTP header `Link: <…>; rel="canonical"` (vercel.json headers, exact paths) — since 14.11 only `/` (/shorts and /chat
  are noindex shells, their Link headers removed); router.js still sets the tag + og:url after JS. Adding an SPA address to the
  sitemap → add its Link header too and drop it from the shell X-Robots-Tag list.
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
- 14.11 «Что нового» /news (branch ads-devlog; AdSense 14.11: «Бесполезный контент»): server-rendered dated posts with our own
  text and engine shots — /news (list, no ads), /news/<slug> (BlogPosting LD, one `forum_article` slot under the text only when the
  post has >= 150 own words, routes/news.js ADS_MIN_WORDS / NEWS_ADS), /news/rss.xml; in sitemap-pages. Data: api/_lib/news-posts.js;
  new post: `python -X utf8 scripts/news-add.py …` (shots → img/news/*.webp < 200 KB); test: node scripts/news-test.mjs. Write a post
  for every engine episode / big site feature: what changed and what is still weak — never filler.

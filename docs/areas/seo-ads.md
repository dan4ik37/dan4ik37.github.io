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

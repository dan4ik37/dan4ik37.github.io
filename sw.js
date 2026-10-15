// ═══════════════════════════════════════
//  SERVICE WORKER dan4ik37.vercel.app — приложение (PWA): офлайн, обновления, push-уведомления
// ═══════════════════════════════════════
// Регистрирует js/features/app.js. Кэши — только свои (d37-shell-*, d37-rt-*; чужие, например d37-rust-* у сборки Rust
// в студии, не трогаем):
//  • d37-shell-<VERSION> — оболочка: главная «/», офлайн-страница, значки, manifest и все скрипты/стили из index.html
//    (список берём из самой index.html при установке — держать его руками не надо);
//  • d37-rt-v1 — по ходу: файлы с ?v= (игры — GAMES_VER, телефон — VER…), картинки, шрифты, supabase-js с CDN.
// Как отвечаем (route):
//  • pass — мимо sw.js, всегда сеть: не GET, /api/* (и /api/geo), /go/* (переходы по рекламе), /_vercel/*, /studio/*, /sdk/*,
//    /.well-known/*, Supabase (и картинки рекламы из его хранилища), YouTube, Twitch, реклама (AdSense, РСЯ), Метрика и любые
//    чужие адреса — живые данные и реклама НИКОГДА не кэшируются;
//  • shell — открыть главную: сеть (свежая версия сайта); нет сети или ждём дольше 8 с — копия; нет копии — офлайн-страница;
//  • page — серверные страницы (/v/…, /games/…, /vip…): сеть, без сети — офлайн-страница (сами страницы не храним);
//  • net — скрипты и стили без номера версии: сеть, без сети — копия (index.html и скрипты не разъезжаются по версиям);
//  • swr — файлы с ?v=, картинки, шрифты: сразу из кэша и тихо обновить (stale-while-revalidate, не чаще раза в час);
//    новый ?v= — новый адрес, старые номера того же файла удаляются;
//  • cdn — неизменные файлы: supabase-js с точным номером версии, файлы шрифтов: из кэша, нет — сеть.
// Обновление: новая версия ставится и ЖДЁТ — app.js показывает «Доступна новая версия — Обновить» и шлёт SKIP_WAITING.
// Самая первая установка и переход со старого sw.js (кэши dan4ik37-shell-v1/v2) — сразу, без кнопки.
// Поменял этот файл — подними VERSION (у всех откроется «Доступна новая версия»). Тест: node scripts/pwa-test.cjs.
const VERSION = 'v3';
const SHELL = 'd37-shell-' + VERSION;
const RT = 'd37-rt-v1';
const MINE = /^(d37-shell-|d37-rt-|dan4ik37-shell-)/;
const LEGACY = ['dan4ik37-shell-v1', 'dan4ik37-shell-v2'];
const OFFLINE = '/offline.html';
const SHELL_FILES = ['/', OFFLINE, '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.ico',
  '/img/app/maskable-192.png', '/img/app/maskable-512.png', '/img/app/badge-96.png'];
const RT_MAX = 400;          // записей в d37-rt — лишние, самые старые, удаляются
const NET_WAIT = 8000;       // столько ждём сеть, если есть копия
const REVALIDATE = 3600e3;   // swr: обновлять копию не чаще раза в час
// Никогда через кэш: реклама, статистика, база, видео и стримы, донаты (чужие адреса и так мимо — это страховка)
const NEVER = /(^|\.)(googlesyndication\.com|doubleclick\.net|googleadservices\.com|google-analytics\.com|googletagmanager\.com|googletagservices\.com|adtrafficquality\.google|fundingchoicesmessages\.google\.com|yandex\.ru|yandex\.net|yandex\.com|yastatic\.net|adfox\.ru|supabase\.co|supabase\.in|youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|www\.googleapis\.com|twitch\.tv|ttvnw\.net|jtvnw\.net|decapi\.me|donationalerts\.com|vercel-insights\.com)$/i;

// ═══ Куда какой запрос ═══
function route(req){
  if (req.method !== 'GET') return 'pass';
  let u; try { u = new URL(req.url); } catch (e) { return 'pass'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'pass';
  if (req.headers && req.headers.get && req.headers.get('range')) return 'pass';          // видео и звук частями
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return 'pass';
  if (NEVER.test(u.hostname)) return 'pass';
  if (u.origin === self.location.origin) {
    const p = u.pathname;
    // /api/* (и /api/geo), /go/* — переходы по рекламе кабинета, /_vercel — статистика: только сеть
    if (/^\/(api|go|_vercel|studio|sdk|\.well-known)(\/|$)/.test(p) || p === '/sw.js') return 'pass';
    if (/^\/(ads\.txt|robots\.txt|llms\.txt|sitemap[\w-]*\.xml|[0-9a-f]{32}\.txt|yandex_[0-9a-f]+\.html)$/.test(p)) return 'pass';
    if (req.mode === 'navigate') return p === '/' || p === '/index.html' ? 'shell' : 'page';
    if (u.searchParams.has('v')) return 'swr';
    if (/\.(png|jpe?g|webp|gif|svg|ico|avif|woff2?|ttf|otf|glb|gltf|mp3|ogg|wav)$/i.test(p)) return 'swr';
    return 'net';
  }
  if (u.hostname === 'cdn.jsdelivr.net' && /^\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\//.test(u.pathname)) return 'cdn';
  if (u.hostname === 'fonts.gstatic.com') return 'cdn';
  if (u.hostname === 'fonts.googleapis.com') return 'swr';
  return 'pass';
}

// Скрипты и стили главной — прямо из index.html (свои js/ и css/ + supabase-js с точной версией)
function shellAssets(html){
  const out = new Set();
  const re = /<(?:script[^>]*\ssrc|link[^>]*\srel="stylesheet"[^>]*\shref)="([^"]+)"/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const u = m[1];
    if (/^\/?(js|css)\/[\w./-]+\.(js|css)$/.test(u) && !u.includes('..')) out.add('/' + u.replace(/^\//, ''));
    else if (/^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\//.test(u)) out.add(u);
  }
  return [...out];
}

// ═══ Помощники ═══
const wait = (p, ms) => new Promise(res => {
  const t = setTimeout(() => res(null), ms);
  p.then(r => { clearTimeout(t); res(r); }, () => { clearTimeout(t); res(null); });
});
async function put(name, req, res){ try { const c = await caches.open(name); await c.put(req, res); } catch (e) {} }
// запись в кэш — пока sw.js жив (браузер не усыпит его посреди записи)
const keep = (event, p) => { try { event.waitUntil(p); } catch (e) {} return p; };
const storable = (res, cross) => !!res && (res.ok && (res.type === 'basic' || res.type === 'cors' || res.type === 'default') || (cross && res.type === 'opaque'));
async function trim(c, req){
  try {
    const keys = await c.keys();
    const u = new URL(req.url);
    if (u.searchParams.has('v')) {     // старые номера того же файла
      for (const k of keys) { const ku = new URL(k.url); if (ku.origin === u.origin && ku.pathname === u.pathname && ku.search !== u.search) await c.delete(k); }
    }
    const left = await c.keys();
    for (let i = 0; i < left.length - RT_MAX; i++) await c.delete(left[i]);
  } catch (e) {}
}
const offline = async () => (await caches.match(OFFLINE)) || new Response('<h1>Нет интернета</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const preload = event => (event.preloadResponse ? Promise.resolve(event.preloadResponse).catch(() => null) : Promise.resolve(null));

// ═══ Ответы ═══
async function shell(event){
  const net = preload(event).then(r => r || fetch(event.request)).then(res => {
    if (storable(res) && !res.redirected) keep(event, put(SHELL, '/', res.clone()));
    return res;
  });
  const res = await wait(net, NET_WAIT);
  if (res && res.status < 500) return res;
  const copy = await caches.match('/', { cacheName: SHELL }) || await caches.match('/');
  if (copy) return copy;
  return res || (await net.catch(() => null)) || offline();
}
async function page(event){
  try { return (await preload(event)) || await fetch(event.request); }
  catch (e) { return offline(); }
}
async function net(event){
  const req = event.request;
  const go = fetch(req, { cache: 'no-cache' }).then(res => { if (storable(res)) keep(event, put(SHELL, req, res.clone())); return res; });
  const res = await wait(go, NET_WAIT);
  if (res) return res;
  return (await caches.match(req)) || go;
}
async function swr(event){
  const req = event.request;
  const cross = new URL(req.url).origin !== self.location.origin;
  const c = await caches.open(RT);
  const hit = await c.match(req);
  const update = () => fetch(req).then(async res => {
    if (storable(res, cross)) { await c.put(req, res.clone()); if (!hit) await trim(c, req); }
    return res;
  });
  if (hit) {
    const age = Date.now() - Date.parse(hit.headers.get('date') || '');
    if (!(age < REVALIDATE)) event.waitUntil(update().catch(() => {}));
    return hit;
  }
  try { return await update(); }
  catch (e) {
    const old = await c.match(req, { ignoreSearch: true });   // нет сети: старый номер того же файла лучше, чем ничего
    if (old) return old;
    throw e;
  }
}
async function cdn(event){
  const req = event.request;
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (storable(res, true)) keep(event, put(RT, req, res.clone()));
  return res;
}
const RUN = { shell, page, net, swr, cdn };

// ═══ Установка, включение, обновление ═══
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.add(new Request(OFFLINE, { cache: 'no-cache' }));     // без офлайн-страницы установка не удалась — браузер повторит
    await Promise.all(SHELL_FILES.filter(u => u !== OFFLINE).map(u => c.add(new Request(u, { cache: 'no-cache' })).catch(() => {})));
    try {
      const home = await c.match('/');
      const list = shellAssets(home ? await home.text() : '');
      // свои — add (только ответ 200); supabase-js с CDN подключён без crossorigin — ответ «непрозрачный», его кладём put
      await Promise.all(list.map(u => (/^https:/.test(u)
        ? fetch(new Request(u, { mode: 'no-cors' })).then(r => (storable(r, true) ? c.put(u, r) : null))
        : c.add(new Request(u, { cache: 'no-cache' }))).catch(() => {})));
    } catch (e) {}
    // переход со старого sw.js (он вставал сам) — тоже сразу; дальше новые версии ждут кнопки «Обновить» (app.js)
    const keys = await caches.keys();
    if (keys.some(k => LEGACY.includes(k))) await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => MINE.test(k) && k !== SHELL && k !== RT).map(k => caches.delete(k)));
    try { if (self.registration.navigationPreload) await self.registration.navigationPreload.enable(); } catch (e) {}
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  // установленное приложение просит держать файлы игр без интернета (app.js → OFFLINE_GAMES)
  if (d.type === 'CACHE_URLS' && Array.isArray(d.urls)) {
    event.waitUntil((async () => {
      const c = await caches.open(RT);
      let n = 0;
      for (const u of d.urls.slice(0, 150)) {
        if (typeof u !== 'string' || !/^\/js\/[\w/.-]+\.js\?v=[\w.-]{1,20}$/.test(u) || u.includes('..')) continue;
        try { if (!(await c.match(u))) { await c.add(new Request(u, { cache: 'no-cache' })); n++; } } catch (e) {}
      }
      try { if (event.source) event.source.postMessage({ type: 'CACHED', n }); } catch (e) {}
    })());
  }
});

self.addEventListener('fetch', event => {
  const kind = route(event.request);
  if (kind === 'pass') return;
  event.respondWith(RUN[kind](event).catch(() => (event.request.mode === 'navigate' ? offline() : Response.error())));
});

// ═══ Web Push: сервер (api/push-check.js) присылает JSON { title, body, url, icon, image, tag } ═══
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(d.title || 'dan4ik37', {
      body: d.body || '',
      icon: d.icon || '/icon-192.png',
      badge: '/img/app/badge-96.png',      // строка состояния Android: только белое по прозрачному
      image: d.image || undefined,
      // С тем же tag новое уведомление тихо заменяет старое в центре уведомлений,
      // не всплывая, — renotify заставляет показать его заново
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { url: d.url || '/#/home' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/#/home', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          return c.navigate(url).then((w) => (w || c).focus()).catch(() => c.focus());
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// для scripts/pwa-test.cjs
self.__d37sw = { route, shellAssets, VERSION, SHELL, RT, NEVER, OFFLINE };

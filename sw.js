// Service Worker для dan4ik37.vercel.app
// Стратегия: network-first с фолбэком в кэш. НЕ cache-first — на сайте живой
// чат, статы YouTube, донаты и т.п., cache-first годами показывал бы
// протухшую версию. Кэш нужен только чтобы сайт вообще открывался офлайн
// или при обрыве связи, а не чтобы ускорять обычную загрузку.
//
// v2: раньше сетевой запрос делался как fetch(req) — это честный поход в сеть,
// но с cache-режимом браузера по умолчанию: если хостинг/CDN когда-нибудь
// начнёт отдавать Cache-Control с заметным max-age на статику, fetch() может
// тихо вернуть версию из ДИСКОВОГО кэша браузера вообще без обращения к
// серверу — и это никак не отличить от «настоящего» сетевого ответа,
// network-first такую подмену не ловит. cache:'no-store' убирает этот риск:
// запрос гарантированно уходит по сети, каким бы ни был Cache-Control ответа.
// Заодно поднята версия кэша — это само по себе меняет байты sw.js, поэтому
// браузер увидит «новый» воркер, установит его (skipWaiting) и сразу возьмёт
// под контроль (clients.claim), а activate() снесёт всё, что лежало под v1.
const CACHE_NAME = 'dan4ik37-shell-v2';
const APP_SHELL = ['/', '/index.html', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // офлайн/нет части файлов при первой установке — не критично
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Трогаем только свои GET-запросы. Supabase (чат/донаты), YouTube API,
  // Twitch-плеер, реклама и любые сторонние домены — мимо кэша, им всегда
  // нужны живые данные.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        // Кэшируем только настоящие успешные ответы — иначе временная 404/500
        // от прокси могла бы застрять в офлайн-фолбэке до следующего успешного визита.
        if (res.ok) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match('/index.html'))
      )
  );
});

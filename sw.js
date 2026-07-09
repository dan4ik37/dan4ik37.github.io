// Service Worker для dan4ik37.vercel.app
// Стратегия: network-first с фолбэком в кэш. НЕ cache-first — на сайте живой
// чат, статы YouTube, донаты и т.п., cache-first годами показывал бы
// протухшую версию. Кэш нужен только чтобы сайт вообще открывался офлайн
// или при обрыве связи, а не чтобы ускорять обычную загрузку.

const CACHE_NAME = 'dan4ik37-shell-v1';
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
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match('/index.html'))
      )
  );
});

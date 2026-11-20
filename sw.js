const CACHE_NAME = 'schedule-cache-v2';

// При активации новой версии удаляем старые кэши, чтобы пользователи сразу получили свежий код
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
});
const urlsToCache = [
  '/CollegeApps/',
  '/CollegeApps/index.html',
  '/CollegeApps/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

const CACHE_NAME = 'schedule-cache-v1';
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

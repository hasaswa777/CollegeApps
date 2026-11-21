/* Расписание НПК — Service Worker v7 (с поддержкой рекламы Яндекса) */

const CACHE = 'college-cache-v7';
const PRECACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
];

// Домены, которые НЕ кэшируем (реклама Яндекса и всё, что с ней связано)
const NO_CACHE_HOSTS = [
    'yandex.ru',
    'yastatic.net',
    'adsystem.yandex.ru',
    'an.yandex.ru',
    'mc.yandex.ru',
    'matchid.adfox.yandex.ru',
    'sync.bumlam.com',
    'ads.adfox.ru'
];

self.addEventListener('install', e => {
    e.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await Promise.allSettled(PRECACHE.map(u => cache.add(u)));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

async function fromCache(cache, request) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (!cached) return null;
    const headers = new Headers(cached.headers);
    headers.set('X-From-Cache', '1');
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers: headers });
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET' || !req.url.startsWith('http')) return;

    // === ПРОПУСКАЕМ РЕКЛАМУ ЯНДЕКСА (не кэшируем, не перехватываем) ===
    try {
        const url = new URL(req.url);
        const host = url.hostname;
        if (NO_CACHE_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
            return; // браузер загрузит напрямую
        }
    } catch (err) { /* ignore */ }
    // ================================================================

    e.respondWith((async () => {
        const cache = await caches.open(CACHE);
        try {
            const res = await fetch(req);
            if (res && res.ok && !res.redirected) cache.put(req, res.clone()).catch(() => {});
            return res;
        } catch (err) {
            const cached = await fromCache(cache, req);
            if (cached) return cached;
            if (req.mode === 'navigate') {
                const shell = await fromCache(cache, './index.html');
                if (shell) return shell;
            }
            throw err;
        }
    })());
});
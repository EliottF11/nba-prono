// Service Worker pour Pick 'n' Swipe (PWA)
const CACHE_NAME = 'pick-n-swipe-v28';
const STATIC_ASSETS = [
  '/',
  '/static/css/style.css?v=28',
  '/static/js/api.js?v=28',
  '/static/js/app.js?v=28',
  '/static/manifest.json',
  '/static/icons/logo-principal.png',
  '/static/icons/logo-secondaire.png',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/apple-touch-icon.png',
  '/static/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Stratégie Network-First pour éviter que les vieux scripts ne soient servis depuis le cache
self.addEventListener('fetch', (event) => {
  // Les requêtes API passent toujours en direct sans interférence
  if (event.request.url.includes('/api/')) {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

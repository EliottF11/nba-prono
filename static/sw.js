// Service Worker pour Pick 'n' Swipe (PWA)
const CACHE_NAME = 'pick-n-swipe-v30';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    })
  );
  self.clients.claim();
});

// Network-First strict : ne met jamais en cache les scripts JS ou CSS pour éviter tout blocage
self.addEventListener('fetch', (event) => {
  if (
    event.request.url.includes('/api/') || 
    event.request.url.includes('.js') || 
    event.request.url.includes('.css') ||
    event.request.method !== 'GET'
  ) {
    return; // Requête réseau directe sans cache
  }
  
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});

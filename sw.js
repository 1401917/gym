const CACHE_NAME = 'protein-flow-cache-v20';
const ASSETS = [
  '/',
  '/index.html',
  '/styles/main.css',
  '/scripts/app.js',
  '/scripts/router.js',
  '/scripts/chat.js',
  '/scripts/data.js',
  '/scripts/engine.js',
  '/scripts/i18n.js',
  '/scripts/offline-ai.js',
  '/scripts/pwa.js',
  '/scripts/storage.js',
  '/scripts/ui.js',
  '/manifest.webmanifest',
  '/assets/icons/app-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  // Do NOT skipWaiting automatically, wait for user confirmation.
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) {
          return cached;
        }

        return caches.match('/index.html');
      })
  );
});

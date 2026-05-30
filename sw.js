const CACHE = 'kakeibo-v1';

const STATIC = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/camera.js',
  './js/ocr.js',
  './js/sheets.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Pass through all cross-origin requests (APIs, Google CDN)
  if (new URL(e.request.url).origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then((cached) => cached ?? fetch(e.request))
  );
});

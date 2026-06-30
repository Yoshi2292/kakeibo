const CACHE = 'kakeibo-v4';

const STATIC_ASSETS = [
  './icons/icon-192.png',
  './icons/icon-512.png',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC_ASSETS)));
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
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // アイコン・マニフェストのみキャッシュ優先、JS/CSS/HTMLは常にネットワーク優先
  const isStaticAsset = /\.(png|ico)$/.test(url.pathname) || url.pathname.endsWith('manifest.json');

  if (isStaticAsset) {
    e.respondWith(caches.match(e.request).then((c) => c ?? fetch(e.request)));
  } else {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});

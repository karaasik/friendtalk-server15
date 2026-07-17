// Service worker: caches the static app shell so the site is installable
// and still opens on a flaky/offline connection.
//
// IMPORTANT: uses a NETWORK-FIRST strategy for the shell files now.
// Previously this was cache-first, which meant that once a phone/browser had
// this app installed, it would keep serving the OLD app.js/style.css forever,
// even after you deployed new versions to the server — that's why updates
// "didn't show up" or seemed to randomly revert. Network-first fixes that:
// every load tries the real server first and only falls back to the cached
// copy if there's no connection.
const CACHE_NAME = 'karasik21-shell-v2';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
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
  const url = new URL(event.request.url);
  // Never cache API calls or the socket.io connection — those must always be live.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const copy = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// Minimal service worker: caches the static app shell so the site is installable
// and opens instantly even on a flaky connection. Chat data itself always comes
// fresh from the server (never cached) since it needs to be live.
//
// v2: switched to network-first for the shell files themselves. Previously this used
// cache-first, which meant that after any code/design update, everyone kept seeing the
// OLD style.css/app.js indefinitely (the cache only refreshes when this very file's
// bytes change, and cache-first never re-checks the network). Bumping CACHE_NAME here
// also forces one clean cache reset for everyone already using the old version.
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

  // Network-first: always try to get the latest file from the server and refresh the
  // cache with it. Only fall back to the cached copy if there's no connection at all.
  // This is what makes future design/code updates show up on next load automatically.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ---------- Push notifications ----------
// Fires even when the app/tab is closed, as long as the browser/OS push service is reachable
// (i.e. the phone has power and a connection — nothing can reach a fully powered-off device).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* ignore malformed payload */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'karasik21', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow(url);
    })
  );
});

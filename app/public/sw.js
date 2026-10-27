// Forewarn service worker: lets the phone install the app and open it offline to the last page.
// Pages: network first, the saved copy when offline. Tiles and assets: the browser cache as usual.
const SHELL = 'forewarn-shell-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/']))); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); return r; }).catch(() => caches.match('/')));
});

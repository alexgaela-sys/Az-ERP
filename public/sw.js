/*
 * YZ ERP service worker.
 *
 * Purpose: PWA installability AND a real offline app shell. It caches the
 * app's OWN static assets (the hashed JS/CSS bundle Vite builds, fonts,
 * icons) as they are successfully fetched, so a later reload with NO
 * network at all still loads the app's code — this is what lets the
 * Cashier screen open at all when the shop's internet is down. It never
 * caches a cross-origin request (Supabase API calls), so the ERP's actual
 * data still only ever comes from the live server or the app's own
 * in-memory/localStorage cache (see src/services/db.ts) — this file only
 * makes the APP ITSELF loadable offline, never the business data.
 */
// v3: now caches same-origin static assets on success (previously only
// index.html was cached, so a true offline reload could serve the shell
// but not its own JS bundle). Bumped so devices on the old worker refresh.
const CACHE_NAME = 'yz-erp-static-v3';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined)
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

// Network-first for navigations with a shell fallback. Same-origin static
// assets are also network-first, but a successful response is cached so a
// later request with NO network can still be served — this is what makes
// the built JS/CSS bundle (and anything else the app loads from itself)
// available offline. A cross-origin request (Supabase, fonts CDN, etc.) is
// never cached here and simply fails like a normal fetch would.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('/index.html', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || Response.error()))
    );
    return;
  }

  const sameOrigin = new URL(req.url).origin === self.location.origin;
  if (!sameOrigin) {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

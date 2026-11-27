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
// v4 (Fix 4, speed-fix list): Vite's build output under /assets/ is
// content-hashed (e.g. /assets/index-7f3a9c2b.js) — the filename itself
// changes whenever the content does, so these specific files can never go
// stale. They're now served cache-first (instant on every repeat visit,
// no network round-trip at all once cached) instead of network-first.
// Everything else (navigations, index.html, manifest, any non-hashed
// same-origin file) is unchanged: still network-first with a cache
// fallback, so a real app update is always picked up on the next reload.
// Bumped so devices on the old worker refresh and adopt the new strategy.
const CACHE_NAME = 'yz-erp-static-v4';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest'];
const isHashedBuildAsset = (url) => /\/assets\//.test(new URL(url).pathname);

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

  if (isHashedBuildAsset(req.url)) {
    // Cache-first: a hashed filename is immutable, so there is never a
    // "stale" cached copy to worry about — check the cache, and only hit
    // the network the first time this exact file is ever requested.
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        });
      })
    );
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

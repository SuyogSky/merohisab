/**
 * MeroHisab — Progressive Web App Service Worker (v3.1.0)
 *
 * Provides offline application shell reliability, resilient cache invalidation,
 * and navigation fallbacks for offline usage in Nepal.
 *
 * Guarantees:
 * - App shell caching without touching or caching private financial state (which resides in IndexedDB).
 * - Safe cache versioning that automatically evicts deprecated cache buckets on update.
 * - Stale-while-revalidate strategy for local assets with offline fallback to index.html.
 * - Explicit fail-fast installation: all required assets must successfully cache or installation fails.
 */

const CACHE_VERSION = "merohisab-v3.1.0";
const CACHE_NAME = "merohisab-v3.1.0";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icons/favicon.svg",
  "./css/main.css",
  "./css/variables.css",
  "./css/reset.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/responsive.css",
  "./js/app.js",
  "./js/core/constants.js",
  "./js/core/demo-data.js",
  "./js/core/migrate-to-idb.js",
  "./js/core/state.js",
  "./js/core/storage.js",
  "./js/core/validator.js",
  "./js/components/confirm-dialog.js",
  "./js/components/modal.js",
  "./js/components/navigation.js",
  "./js/components/toast.js",
  "./js/services/analytics.js",
  "./js/services/budgets.js",
  "./js/services/goals.js",
  "./js/services/insights.js",
  "./js/services/transactions.js",
  "./js/utils/canvas-charts.js",
  "./js/utils/file-io.js",
  "./js/utils/formatters.js",
  "./js/utils/indexed-db.js",
  "./js/utils/money.js",
  "./js/utils/nepali-calendar.js",
  "./js/views/dashboard.js",
  "./js/views/accounts.js",
  "./js/views/transactions.js",
  "./js/views/recurring.js",
  "./js/views/bills.js",
  "./js/views/budgets.js",
  "./js/views/goals.js",
  "./js/views/analytics.js",
  "./js/views/settings.js"
];

// Pre-cache application shell assets during install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Purge obsolete cache buckets on activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("merohisab-") && key !== CACHE_NAME)
            .map((oldKey) => caches.delete(oldKey))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Intercept fetch requests: Cache-first / Stale-while-revalidate for local assets
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle HTTP/HTTPS GET requests
  if (req.method !== "GET" || !req.url.startsWith("http")) {
    return;
  }

  // Handle SPA navigation requests
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Stale-while-revalidate for local application shell assets
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background to revalidate cache
        fetch(req)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(req, responseToCache);
              });
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(req)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          // Fallback to offline index for html requests
          if (req.headers.get("accept")?.includes("text/html")) {
            return caches.match("./index.html");
          }
        });
    })
  );
});

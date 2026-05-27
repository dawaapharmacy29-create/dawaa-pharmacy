/**
 * صيدليات دواء — Service Worker
 * Versioned cache + offline fallback + auto-update
 */

const APP_VERSION = "dawaa-v1.4.1-no-live-data-cache";
const CACHE_STATIC = `${APP_VERSION}-static`;
const CACHE_DYNAMIC = `${APP_VERSION}-dynamic`;
const CACHE_IMAGES = `${APP_VERSION}-images`;

// Assets to pre-cache on install
const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

// Max entries for dynamic cache
const DYNAMIC_CACHE_MAX = 60;
const IMAGE_CACHE_MAX = 40;

// Live data routes must never be cached. Supabase data is the source of truth.
const NO_STORE_PATTERNS = [
  /supabase\.co/,
  /backend\.onspace\.ai/,
  /api\./,
];

const NO_STORE_ROUTE_PREFIXES = [
  "/customers",
  "/customer-service",
  "/analytics",
  "/dashboard",
  "/import-invoices",
  "/invoices",
  "/shift-notes",
];

// Cache-first routes (serve from cache, update in background)
const CACHE_FIRST_PATTERNS = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdn-ai\.onspace\.ai/,
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log(`[SW] Installing ${APP_VERSION}`);
  event.waitUntil(
    caches
      .open(CACHE_STATIC)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => {
        console.log(`[SW] Pre-cache complete`);
        // Force activate immediately (skip waiting for old SW)
        return self.skipWaiting();
      })
      .catch((err) => console.warn("[SW] Pre-cache error:", err))
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log(`[SW] Activating ${APP_VERSION}`);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const validCaches = [CACHE_STATIC, CACHE_DYNAMIC, CACHE_IMAGES];
        return Promise.all(
          keys
            .filter((key) => !validCaches.includes(key))
            .map((key) => {
              console.log(`[SW] Deleting old cache: ${key}`);
              return caches.delete(key);
            })
        );
      })
      .then(() => {
        console.log(`[SW] Old caches cleared`);
        // Take control of all open pages immediately
        return self.clients.claim();
      })
      .then(() => {
        // Notify all clients that a new version is active
        return self.clients.matchAll({ type: "window" }).then((clients) => {
          clients.forEach((client) =>
            client.postMessage({ type: "SW_UPDATED", version: APP_VERSION })
          );
        });
      })
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== "GET") return;
  if (url.protocol === "chrome-extension:") return;

  // Supabase/API calls: always network, never cache dynamic operational data.
  if (NO_STORE_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(networkOnly(request));
    return;
  }

  if (request.mode === "navigate" && url.origin === self.location.origin && NO_STORE_ROUTE_PREFIXES.some((path) => url.pathname.startsWith(path))) {
    event.respondWith(fetch(request.clone(), { cache: "no-store" }).catch(async () => (await caches.match("/offline.html")) || new Response("", { status: 503 })));
    return;
  }

  // Cache-first: fonts, CDN images
  if (CACHE_FIRST_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(cacheFirst(request, CACHE_IMAGES, IMAGE_CACHE_MAX));
    return;
  }

  // Navigation requests: serve app shell, fallback to offline
  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Static assets (JS, CSS, etc.): stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ─── Strategies ───────────────────────────────────────────────────────────────

/** Network only for live Supabase/API data */
async function networkOnly(request) {
  try {
    return await fetch(request.clone(), { cache: "no-store" });
  } catch {
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }
}

/** Network first → cache fallback */
async function networkFirst(request) {
  try {
    const networkRes = await fetch(request.clone());
    if (networkRes.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, networkRes.clone());
    }
    return networkRes;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/** Cache first → network fallback + cache update */
async function cacheFirst(request, cacheName = CACHE_IMAGES, maxEntries = 40) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkRes = await fetch(request.clone());
    if (networkRes.ok) {
      const cache = await caches.open(cacheName);
      await limitCacheSize(cache, maxEntries);
      cache.put(request, networkRes.clone());
    }
    return networkRes;
  } catch {
    return new Response("", { status: 408 });
  }
}

/** Stale-while-revalidate */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_DYNAMIC);
  const cached = await cache.match(request);

  const networkPromise = fetch(request.clone())
    .then((res) => {
      if (res.ok) {
        limitCacheSize(cache, DYNAMIC_CACHE_MAX).then(() =>
          cache.put(request, res.clone())
        );
      }
      return res;
    })
    .catch(() => null);

  return cached || (await networkPromise) || new Response("", { status: 408 });
}

/** Navigation: try network, fallback to static cache, then offline.html */
async function navigationHandler(request) {
  try {
    const networkRes = await fetch(request.clone());
    if (networkRes.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, networkRes.clone());
    }
    return networkRes;
  } catch {
    // Try cached version of root
    const cached =
      (await caches.match(request)) || (await caches.match("/"));
    if (cached) return cached;
    // Last resort: offline page
    const offlinePage = await caches.match("/offline.html");
    return (
      offlinePage ||
      new Response("<h1>أنت غير متصل بالإنترنت</h1>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
  }
}

/** Enforce max cache size by evicting oldest entries */
async function limitCacheSize(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((k) => cache.delete(k)));
  }
}

// ─── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || "صيدليات دواء", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      dir: "rtl",
      lang: "ar",
      tag: data.tag || "dawaa-notif",
      renotify: true,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.includes(targetUrl));
        if (existing) return existing.focus();
        return self.clients.openWindow(targetUrl);
      })
  );
});

// ─── Skip Waiting message ────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    console.log("[SW] Skip waiting — activating new SW");
    self.skipWaiting();
  }
  if (event.data?.type === "CLEAR_CACHE") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    );
  }
});

// ─── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-activity") {
    console.log("[SW] Background sync: sync-activity");
  }
});

console.log(`[SW] ${APP_VERSION} loaded`);

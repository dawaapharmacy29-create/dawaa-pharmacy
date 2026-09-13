/**
 * صيدليات دواء — Service Worker
 * Versioned cache + offline fallback + auto-update
 */

const APP_VERSION = 'dawaa-v22.0-web-push-20260913';
const CACHE_STATIC = `${APP_VERSION}-static`;
const CACHE_DYNAMIC = `${APP_VERSION}-dynamic`;
const CACHE_IMAGES = `${APP_VERSION}-images`;

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Max entries for dynamic cache
const DYNAMIC_CACHE_MAX = 60;
const IMAGE_CACHE_MAX = 40;

// Live data routes must never be cached. Supabase data is the source of truth.
const NO_STORE_PATTERNS = [/supabase\.co/, /backend\.onspace\.ai/, /api\./];

const NO_STORE_ROUTE_PREFIXES = [
  '/customers',
  '/customer-service',
  '/activity-log',
  '/points',
  '/team',
  '/staff',
  '/analytics',
  '/dashboard',
  '/import-invoices',
  '/invoices',
  '/shift-notes',
];

// Cache-first routes (serve from cache, update in background)
const CACHE_FIRST_PATTERNS = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdn-ai\.onspace\.ai/,
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
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
      .catch((err) => console.warn('[SW] Pre-cache error:', err))
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
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
        return self.clients.matchAll({ type: 'window' }).then((clients) => {
          clients.forEach((client) =>
            client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION })
          );
        });
      })
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Supabase/API calls: always network, never cache dynamic operational data.
  if (NO_STORE_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(networkOnly(request));
    return;
  }

  if (
    request.mode === 'navigate' &&
    url.origin === self.location.origin &&
    NO_STORE_ROUTE_PREFIXES.some((path) => url.pathname.startsWith(path))
  ) {
    event.respondWith(
      fetch(request.clone(), { cache: 'no-store' }).catch(
        async () => (await caches.match('/offline.html')) || new Response('', { status: 503 })
      )
    );
    return;
  }

  // Cache-first: fonts, CDN images
  if (CACHE_FIRST_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(cacheFirst(request, CACHE_IMAGES, IMAGE_CACHE_MAX));
    return;
  }

  // Navigation requests: serve app shell, fallback to offline
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Vite assets are content-hashed. Prefer the network so a deployment can
  // never combine a new HTML shell with stale JavaScript chunks.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets (JS, CSS, etc.): stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ─── Strategies ───────────────────────────────────────────────────────────────

/** Network only for live Supabase/API data */
async function networkOnly(request) {
  try {
    return await fetch(request.clone(), { cache: 'no-store' });
  } catch {
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }
}

/** Network first → cache fallback */
async function networkFirst(request) {
  try {
    const networkRes = await fetch(request.clone(), { cache: 'no-store' });
    if (networkRes.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      try {
        await cache.put(request, networkRes.clone());
      } catch (error) {
        console.warn('SW cache put failed', error);
      }
    }
    return networkRes;
  } catch {
    const cached = await caches.match(request);
    return (
      cached ||
      new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );
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
      try {
        await cache.put(request, networkRes.clone());
      } catch (error) {
        console.warn('SW cache put failed', error);
      }
    }
    return networkRes;
  } catch {
    return new Response('', { status: 408 });
  }
}

/** Stale-while-revalidate */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_DYNAMIC);
  const cached = await cache.match(request);

  const networkPromise = fetch(request.clone())
    .then(async (res) => {
      if (res.ok) {
        try {
          await limitCacheSize(cache, DYNAMIC_CACHE_MAX);
          if (!res.bodyUsed) {
            await cache.put(request, res.clone());
          }
        } catch (error) {
          console.warn('SW stale cache put failed', error);
        }
      }
      return res;
    })
    .catch(() => null);

  return cached || (await networkPromise) || new Response('', { status: 408 });
}

/** Navigation: try network, fallback to static cache, then offline.html */
async function navigationHandler(request) {
  try {
    // HTML must always come from the active deployment.
    return await fetch(request.clone(), { cache: 'no-store' });
  } catch {
    // Offline HTML is the only navigation fallback kept in cache.
    const offlinePage = await caches.match('/offline.html');
    return (
      offlinePage ||
      new Response('<h1>أنت غير متصل بالإنترنت</h1>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
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
function safePushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

function pushPresentation(data) {
  const category = String(data.category || data.type || '').toLowerCase();
  const branch = String(data.branch || data.branchName || '').trim();
  const score = data.score ?? data.reviewScore;
  const customer = String(data.customerName || data.customer || '').trim();
  const doctor = String(data.doctorName || data.doctor || data.assigneeName || '').trim();
  const task = String(data.taskName || data.task || '').trim();
  const reason = String(data.reason || data.mainReason || data.actionReason || '').trim();
  const delay = String(data.delayText || data.overdueText || data.silenceText || '').trim();

  let title = String(data.title || '').trim();
  let body = String(data.body || data.message || '').trim();

  if (!title && /review/.test(category)) {
    title = `تقييم يحتاج مراجعة${branch ? ` — ${branch}` : ''}${score !== undefined && score !== null ? ` — ${score}/100` : ''}`;
  } else if (!title && /follow/.test(category)) {
    title = `${customer || 'متابعة عميل'} — تحتاج متابعة`;
  } else if (!title && /vip/.test(category)) {
    title = `${customer || 'عميل VIP'} — يحتاج تدخل`;
  } else if (!title && /task/.test(category)) {
    title = task || 'مهمة تحتاج إجراء';
  }

  if (!body) {
    body = [doctor, reason, delay, branch].filter(Boolean).join(' — ');
  }

  return {
    title: title || 'صيدليات دواء',
    body: body.slice(0, 280),
  };
}

self.addEventListener('push', (event) => {
  const data = safePushPayload(event);
  const presentation = pushPresentation(data);
  const priority = String(data.priority || '').toLowerCase();
  const urgent = Boolean(data.requireInteraction || data.urgent)
    || /urgent|critical|عاجل|حرج|خطر/.test(priority);
  const eventKey = String(data.tag || data.signalKey || data.notificationId || data.id || `${data.category || data.type || 'notif'}-${data.targetId || data.entityId || ''}`);

  event.waitUntil(
    self.registration.showNotification(presentation.title, {
      body: presentation.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      tag: `dawaa-${eventKey}`,
      renotify: false,
      requireInteraction: urgent,
      silent: false,
      data: {
        url: data.url || data.targetUrl || '/',
        notificationId: data.notificationId || data.id || null,
        category: data.category || data.type || null,
      },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawTarget = event.notification.data?.url || '/';
  const targetUrl = new URL(rawTarget, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const exact = windows.find((client) => client.url === targetUrl);
    if (exact) return exact.focus();

    const appWindow = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    if (appWindow) {
      try {
        if ('navigate' in appWindow) await appWindow.navigate(targetUrl);
      } catch (error) {
        console.warn('[SW] Failed to navigate existing client', error);
      }
      return appWindow.focus();
    }

    return self.clients.openWindow(targetUrl);
  })());
});

// ─── Skip Waiting message ────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting — activating new SW');
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    );
  }
});

// ─── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-activity') {
    console.log('[SW] Background sync: sync-activity');
  }
});

console.log(`[SW] ${APP_VERSION} loaded`);

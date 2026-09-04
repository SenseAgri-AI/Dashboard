// SenseAgri PWA service worker — conservative by design.
// Immutable build assets are served cache-first; auth'd pages and API/live-data always hit the network
// (Clerk sessions + live sensor data must never be served stale); navigations fall back to an offline
// page only when the network is unreachable. No offline data caching.
const VERSION = "senseagri-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png", "/apple-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isStaticAsset = (p) =>
  p.startsWith("/_next/static/") || /\.(?:png|jpe?g|svg|gif|ico|webp|woff2?|ttf)$/.test(p);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin (Clerk, S3, fonts) untouched
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/__clerk")) return; // never cache

  // Immutable build assets → cache-first.
  if (isStaticAsset(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(STATIC_CACHE)).put(req, res.clone());
        return res;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Page navigations → network-first, offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
  }
});

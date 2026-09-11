// SenseAgri PWA service worker — conservative by design.
// Immutable build assets are served cache-first; auth'd pages and API/live-data always hit the network
// (Clerk sessions + live sensor data must never be served stale); navigations fall back to an offline
// page only when the network is unreachable. No offline data caching.
const VERSION = "senseagri-v2";
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

// ── Web Push ──────────────────────────────────────────────────────────────────
// A push message wakes this worker even when the app is closed: show the notification, and on tap
// focus an existing tab (or open the app) at the notification's URL. Payload is JSON: {title, body,
// url, tag}.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: "SenseAgri", body: event.data ? event.data.text() : "" }; }
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,       // same tag replaces an earlier one instead of stacking
    data: { url: typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/dashboard" },
  };
  event.waitUntil((async () => {
    let status = "displayed";
    try {
      await self.registration.showNotification(data.title || "SenseAgri", options);
    } catch (error) {
      status = "display-failed";
      if (!data.testId) throw error;
    }
    // Local receipt only: no backend writes or broadcasts to other devices.
    // showNotification resolving is not proof that the OS showed a banner.
    if (typeof data.testId === "string") {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) client.postMessage({ type: "senseagri-push-test", testId: data.testId, status });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/dashboard", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : new URL("/dashboard", self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) if (c.url.includes(url) && "focus" in c) return c.focus();
    if (clients.length && "navigate" in clients[0]) { try { await clients[0].navigate(url); } catch {} return clients[0].focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

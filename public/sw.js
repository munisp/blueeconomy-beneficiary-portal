/*
 * Minimal offline shell for the CVFF Beneficiary Portal.
 *
 * Scope of honesty: this worker only caches the same-origin static shell so
 * the portal still opens offline with an explicit notice. It never
 * intercepts CVFF API or identity-provider traffic — cross-origin requests
 * are left to the network untouched.
 */
const CACHE_NAME = "cvff-shell-v1";
const PRECACHE_URLS = ["/", "/index.html", "/offline.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  // Never touch the CVFF API, the identity provider, or any other origin.
  if (url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("/index.html");
          return cached ?? (await caches.match("/offline.html")) ?? Response.error();
        }),
    );
    return;
  }
  // Cache-first for static shell assets, with runtime fill of hashed bundles.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

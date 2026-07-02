const CACHE_NAME = "qrtools-v2";
const BASE = new URL("./", self.registration.scope).pathname;

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

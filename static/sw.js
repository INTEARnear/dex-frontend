const CACHE_NAME = "dex-frontend-v1";

const CACHEABLE_EXTENSIONS = /\.(html|css|js|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico)$/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  const isNavigation = request.mode === "navigate";
  const isCacheableAsset = CACHEABLE_EXTENSIONS.test(url.pathname);

  if (!isNavigation && !isCacheableAsset) return;

  // Stale-while-revalidate: serve from cache immediately, update cache in background
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const fetched = fetch(request).then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        });
        return cached || fetched;
      })
    )
  );
});

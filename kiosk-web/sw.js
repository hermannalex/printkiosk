// Cache do app para abrir mesmo sem internet. Sempre tenta a rede primeiro,
// então uma atualização chega sozinha quando há conexão.
const CACHE = "imprime-kiosk-v3";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "cloud.js",
  "manifest.webmanifest",
  "vendor/pdf.min.mjs",
  "vendor/pdf.worker.min.mjs",
  "vendor/qr.mjs",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || Response.error())),
  );
});

const CACHE = "nfc-leads-v1";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener("fetch", (event) => { if (event.request.method === "GET" && new URL(event.request.url).origin === location.origin) event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request))); });

// Offline cache for the app shell. Bump VERSION when you change any file.
const VERSION = "podium-v1";
const SHELL = ["./", "index.html", "app.js", "app.css", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.includes("/api/")) return;
  // network first so updates show up, cache as fallback when offline
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && url.origin === location.origin) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(m => m || caches.match("index.html"))));
});

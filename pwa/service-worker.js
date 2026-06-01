const CACHE_NAME = "domodoro-pwa-v27";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./app.js?v=27",
  "./manifest.webmanifest",
  "../assets/characters/default/default.png",
  "../assets/characters/default/thinking.png",
  "../assets/characters/default/stern.png",
  "../assets/characters/default/pointing.png",
  "../assets/characters/default/approval.png",
  "../assets/characters/default/beckon.png",
  "../assets/characters/default/headshot.png",
  "../assets/characters/silk/default.png",
  "../assets/characters/silk/thinking.png",
  "../assets/characters/silk/stern.png",
  "../assets/characters/silk/pointing.png",
  "../assets/characters/silk/approval.png",
  "../assets/characters/silk/beckon.png",
  "../assets/characters/silk/headshot.png",
  "../assets/characters/director/default.png",
  "../assets/characters/director/thinking.png",
  "../assets/characters/director/stern.png",
  "../assets/characters/director/pointing.png",
  "../assets/characters/director/approval.png",
  "../assets/characters/director/beckon.png",
  "../assets/characters/director/headshot.png",
  "../assets/characters/chrome/default.png",
  "../assets/characters/chrome/thinking.png",
  "../assets/characters/chrome/stern.png",
  "../assets/characters/chrome/pointing.png",
  "../assets/characters/chrome/approval.png",
  "../assets/characters/chrome/beckon.png",
  "../assets/characters/chrome/headshot.png",
  "../assets/characters/king/default.png",
  "../assets/characters/king/thinking.png",
  "../assets/characters/king/stern.png",
  "../assets/characters/king/pointing.png",
  "../assets/characters/king/approval.png",
  "../assets/characters/king/beckon.png",
  "../assets/characters/king/headshot.png",
  "../assets/paperclip-logo-192.png",
  "../assets/paperclip-logo-512.png",
  "../assets/outfits.png",
  "../transformers.js",
  "../vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs",
  "../vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

const CACHE_NAME = 'aspria-v0.2.2';
const APP_FILES = ['./', './index.html', './style.css?v=0.2.2', './app.js?v=0.2.2', './excel-import.js?v=0.2.2', './jszip.min.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('aspria-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin)return;
  event.respondWith(fetch(event.request).then(response => {
    if(response.ok){const clone=response.clone();caches.open(CACHE_NAME).then(cache => cache.put(event.request,clone)).catch(()=>{});}
    return response;
  }).catch(async () => {
    const cached=await caches.match(event.request);
    if(cached)return cached;
    if(event.request.mode === 'navigate')return (await caches.match('./index.html')) || Response.error();
    return Response.error();
  }));
});

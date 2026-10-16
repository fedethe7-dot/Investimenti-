/* Funziona anche offline. I file dell'app: prima dalla rete (così gli aggiornamenti arrivano), se manca la rete dalla copia salvata.
   Il modulo Excel e i caratteri: dalla copia salvata. Il Foglio Google non passa mai da qui. */
const CACHE = 'portafoglio-v1';
const APP = ['./', 'index.html', 'app.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP).then(() => c.add(XLSX).catch(() => {}))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com')) return;
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
    return;
  }
  if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname.startsWith('fonts.')) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
      return res;
    })));
  }
});

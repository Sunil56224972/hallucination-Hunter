// Hallucination Hunter service worker.
// Pages: network first, cached copy when offline.
// Static files and fonts: serve from cache, refresh in the background.
// API calls and storage requests are never cached.

const VERSION = 'hh-v3';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'assets/favicon-32.png',
  'assets/icon-192.png'
];
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put('index.html', fresh.clone());
    return fresh;
  } catch (err) {
    return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then(res => {
      if (res.ok || res.type === 'opaque') cache.put(event.request, res.clone());
      return res;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    if (request.mode === 'navigate') { event.respondWith(networkFirst(request)); return; }
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
  if (CACHEABLE_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(event));
});

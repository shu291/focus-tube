/* 筋トレ割り当て Service Worker
   - アプリ本体をキャッシュして、ネットがなくても起動できるようにする */
const CACHE = 'workout-scheduler-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  '../icon.svg',
  '../apple-touch-icon.png',
  '../icon-192.png',
  '../icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(resp => {
      if (resp && resp.ok && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return resp;
    }).catch(() => null);

    if (cached) { network; return cached; }
    const net = await network;
    if (net) return net;
    if (req.mode === 'navigate') return (await caches.match('./index.html'));
    return new Response('', { status: 504, statusText: 'offline' });
  })());
});

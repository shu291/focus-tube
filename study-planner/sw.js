/* 逆算プランナー Service Worker
   - HTMLはネットワーク優先: mainにpush → GitHub Pagesが自動デプロイ → 次に開いたとき自動で最新版になる
   - オフライン時はキャッシュから起動できる
   - 記録データ(localStorage / IndexedDB)はキャッシュと無関係なので、更新しても消えない
*/
const CACHE = 'study-planner-v1';
const SHELL = [
  './',
  './index.html',
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
  if (url.origin !== self.location.origin) return; // GitHub API等の外部は素通し

  const isHTML = req.mode === 'navigate' || url.pathname.endsWith('.html');

  event.respondWith((async () => {
    if (isHTML) {
      try {
        const net = await fetch(req);
        if (net && net.ok) { const copy = net.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return net;
      } catch (e) {
        const cached = await caches.match(req) || await caches.match('./index.html');
        if (cached) return cached;
        return new Response('', { status: 504, statusText: 'offline' });
      }
    }
    const cached = await caches.match(req);
    const network = fetch(req).then(resp => {
      if (resp && resp.ok && resp.type === 'basic') { const copy = resp.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return resp;
    }).catch(() => null);
    if (cached) { network; return cached; }
    const net = await network;
    if (net) return net;
    return new Response('', { status: 504, statusText: 'offline' });
  })());
});

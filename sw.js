/* FocusTube Service Worker
   - アプリ本体(HTML/アイコン等)をキャッシュして、ネットがなくても起動できるようにする
   - Web Share Target で送られた動画ファイルを受け取り、オフラインライブラリに渡す
*/
const CACHE = 'focustube-v2';
const SHELL = [
  './',
  './index.html',
  './offline.html',
  './background-player.html',
  './manifest.webmanifest',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
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

/* ---- 共有ファイルの受け渡し用 IndexedDB ---- */
function shareDB(){
  return new Promise((res, rej) => {
    const req = indexedDB.open('focusTube.share', 1);
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('pending')) d.createObjectStore('pending', { keyPath:'id', autoIncrement:true }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function stashShared(files){
  const d = await shareDB();
  await new Promise((res, rej) => {
    const tx = d.transaction('pending', 'readwrite');
    tx.objectStore('pending').put({ files, at: Date.now() });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Web Share Target: 共有された動画ファイルを受け取り offline.html へ
  if (req.method === 'POST' && url.pathname.endsWith('/offline.html')) {
    event.respondWith((async () => {
      try{
        const form = await req.formData();
        const files = form.getAll('media').filter(f => f && typeof f === 'object' && 'name' in f);
        if (files.length) await stashShared(files);
      }catch(e){ /* 失敗しても遷移は続行 */ }
      return Response.redirect(new URL('offline.html?shared=1', self.location.origin + url.pathname).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

  // 自分のオリジンのリクエストだけ扱う。YouTube等の外部は素通し(オフライン時は当然失敗)。
  if (url.origin !== self.location.origin) return;

  // アプリ本体: キャッシュ優先 + バックグラウンドで更新
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(resp => {
      if (resp && resp.ok && resp.type === 'basic'){
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return resp;
    }).catch(() => null);

    if (cached) { network; return cached; }
    const net = await network;
    if (net) return net;
    // ナビゲーションのフォールバック
    if (req.mode === 'navigate') return (await caches.match('./offline.html')) || (await caches.match('./index.html'));
    return new Response('', { status: 504, statusText: 'offline' });
  })());
});

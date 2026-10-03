// バージョンを変えるとキャッシュが更新されます
const V = 'pj-pricing-v95';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 画面の一番下に出すバージョンの問い合わせ。
   いま動いているSW自身が答えるので、表示と実際の版がずれない。 */
self.addEventListener('message', e => {
  if (e.data && e.data.ask === 'version') {
    const v = (/pj-pricing-(v\d+)/.exec(V) || [])[1] || V;
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ version: v });
    else if (e.source && e.source.postMessage) e.source.postMessage({ version: v });
  }
});

// ネットワーク優先・失敗したらキャッシュ（更新を取りこぼさず、圏外でも動く）
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 外部API（為替の自動取得など）はSWを素通りさせる。キャッシュに載せる意味がなく、
  // 失敗時にこのSWが index.html を返すとJSONの取得失敗と区別できなくなるため。
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const copy = r.clone();
        caches.open(V).then(c => c.put(e.request, copy)).catch(() => {});
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

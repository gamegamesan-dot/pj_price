// バージョンを変えるとキャッシュが更新されます
const V = 'pj-pricing-v213';
const ASSETS = [
  './',
  './index.html',
  // 値付けの式（index.html と pj-sync が同じファイルを読む）。
  // index.html と必ずセットで更新されるよう、バージョン（V）で束ねて入れておく。
  './shared/pricing.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

/* バーコードの読み取りの部品（6.92）。版を固定して jsdelivr から読む。
   ・**別に入れて、失敗しても install を止めない**（CDN が落ちている日に
     アプリ全体が入らなくなるのを避ける）
   ・内容は版で固定されているので、取れたらキャッシュ優先で返す */
const EXTRA = [
  'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js'
];

/* 先読みは必ずサーバーから取り直す（cache:'reload'）。
   素の addAll はブラウザのHTTPキャッシュを通すので、Pages が付ける短い max-age の
   あいだは古い index.html が新しいキャッシュに入ってしまい、
   「SWは新しいのに画面は古い」状態の原因になる。 */
self.addEventListener('install', e => {
  const reqs = ASSETS.map(u => new Request(u, { cache: 'reload' }));
  e.waitUntil(caches.open(V).then(c => c.addAll(reqs)).then(() => self.skipWaiting()));
  /* 外から読む部品は**別に**入れる。1つでも失敗すると addAll は全部やめて
     しまうので、本体（ASSETS）と同じ待ち受けに混ぜない。 */
  e.waitUntil(caches.open(V).then(c => Promise.all(
    EXTRA.map(u => c.add(new Request(u, { cache: 'reload', mode: 'cors' }))
      .catch(() => {})))));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      /* 開いたままの画面に知らせる。clients.claim() はSWを引き継ぐだけで、
         画面のHTMLは古いまま残る（ホーム画面アプリでは特に起きやすい）。 */
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(cs => {
        const v = (/pj-pricing-(v\d+)/.exec(V) || [])[1] || V;
        cs.forEach(c => { try { c.postMessage({ version: v }); } catch (err) {} });
      })
  );
});

/* いま動いているSW自身の版を答える。画面側はこれを APP_V（HTML自身の版）と
   見比べて、古いHTMLのまま動いていないかを見分ける。 */
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
  /* 外から読む部品（EXTRA）だけは、キャッシュ優先で返す（版で固定されている）。
     圏外でもカメラの読み取りが使えるようにするため。 */
  if (EXTRA.indexOf(e.request.url) >= 0) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(V).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })));
    return;
  }
  if (new URL(e.request.url).origin !== self.location.origin) return;
  /* 画面そのもの（HTML）は、ブラウザのHTTPキャッシュを通さずに取り直す。
     通してしまうと古いHTMLが返り、SWだけ新しい状態になることがある。 */
  const doc = e.request.mode === 'navigate' || e.request.destination === 'document';
  const req = doc ? new Request(e.request.url, { cache: 'reload', credentials: 'same-origin' })
                  : e.request;
  e.respondWith(
    fetch(req)
      .then(r => {
        const copy = r.clone();
        caches.open(V).then(c => c.put(e.request, copy)).catch(() => {});
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

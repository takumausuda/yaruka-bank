/* やる価バンク 2.0 — Service Worker(オフライン対応)
 * キャッシュファースト戦略。アプリ更新時は CACHE_VERSION を上げる。 */

const CACHE_VERSION = 'yaruka-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Anthropic API 呼び出しはキャッシュしない(手順3で使用)
  if (event.request.url.includes('api.anthropic.com')) return;

  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(res => {
        // 同一オリジンの GET のみキャッシュに追加
        if (event.request.method === 'GET' && res.ok && new URL(event.request.url).origin === location.origin) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return res;
      })
    )
  );
});

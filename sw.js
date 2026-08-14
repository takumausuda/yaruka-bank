/* やる価バンク 2.0 — Service Worker(オフライン対応)
 * ネットワークファースト戦略: オンライン時は常に最新を取得してキャッシュを更新し、
 * オフライン時のみキャッシュから返す(更新の反映遅れを防ぐ)。 */

const CACHE_VERSION = 'yaruka-v7';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/ai.js',
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
  // Anthropic API 呼び出しはキャッシュしない
  if (event.request.url.includes('api.anthropic.com')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).then(res => {
      // オンライン: 最新を返しつつ、同一オリジンのものはキャッシュを更新
      if (res.ok && new URL(event.request.url).origin === location.origin) {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
      }
      return res;
    }).catch(() =>
      // オフライン: キャッシュから返す(ページ遷移は index.html にフォールバック)
      caches.match(event.request).then(cached =>
        cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())
      )
    )
  );
});

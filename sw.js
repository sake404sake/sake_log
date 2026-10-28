const CACHE_NAME = 'sakelog-shell-v13';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './src/main.js',
  './src/views/breweryMap.js',
  './src/store/db.js',
  './src/store/state.js',
  './src/services/gemini.js',
  './src/services/googleDrive.js',
  './src/utils/image.js',
  './src/views/analytics.js',
  './src/views/batchImport.js',
  './src/views/lightbox.js',
  './src/views/logDetail.js',
  './src/views/logEditor.js',
  './src/views/logList.js',
  './src/views/settings.js',
  './src/icons/favicon.png',
  './src/icons/apple-touch-icon.png',
  './src/icons/icon-192.png',
  './src/icons/icon-512.png',
  './src/icons/icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE_ASSETS.map(async asset => {
      try {
        await cache.add(asset);
      } catch (error) {
        console.error(`[ServiceWorker] Failed to cache ${asset}:`, error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith('sakelog-shell-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch {
        const cachedPage = await caches.match('./index.html');
        if (cachedPage) return cachedPage;
        throw new Error('SakeLog is not available offline until it has been opened online once.');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const canonicalUrl = new URL(request.url);
    canonicalUrl.search = '';
    const cachedAsset = await cache.match(canonicalUrl.href) || await cache.match(request);
    const updateCache = fetch(request).then(async response => {
      if (response.ok) await cache.put(canonicalUrl.href, response.clone());
      return response;
    });

    if (cachedAsset) {
      event.waitUntil(updateCache.catch(error => {
        console.warn('[ServiceWorker] Offline; serving cached asset:', request.url, error);
      }));
      return cachedAsset;
    }

    return updateCache;
  })());
});

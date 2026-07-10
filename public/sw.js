const CACHE = 'qhd-tcm-jobs-v2';
const ASSETS = ['./', './styles.css', './app.js', './manifest.json', './icon.svg', './data/jobs.json'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  if (new URL(event.request.url).pathname.endsWith('/data/jobs.json')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => caches.match('./data/jobs.json')));
    return;
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

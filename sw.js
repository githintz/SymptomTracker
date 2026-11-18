// Offline support: the app shell is cached so logging works with no signal.
// Bump VERSION whenever any file below changes so phones pick up the update.
const VERSION = 'st-v5';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/store.js', 'js/sync.js', 'js/crypto.js', 'js/ui.js', 'js/sheets.js', 'js/charts.js', 'js/stats.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];
const FONTS = 'st-fonts';

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never stores stale files
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts: cache once, reuse offline
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return; // sync server and CDNs: always network
  if (url.pathname.endsWith('/config.json')) {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put('config.json', copy)); return r; }).catch(() => caches.match('config.json')));
    return;
  }
  // app shell: cache first (fast and offline), navigation falls back to index.html
  e.respondWith(caches.open(VERSION).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => hit || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});

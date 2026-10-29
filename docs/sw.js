// Service worker minimal : met en cache la coquille de l'app pour l'installation.
// Les appels au Google Sheet passent toujours par le réseau.
const CACHE = 'coop-scan-v45';
const SHELL = [
  './', './index.html', './cartes', './cartes.html', './membre', './membre.html', './styles.css', './data.js', './app.js',
  './auth.js', './config.js', './install.js', './manifest.webmanifest', './icons/logo.jpg', './icons/flower.png', './icons/favicon.png', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/scanner-180.png', './icons/scanner-192.png', './icons/scanner-favicon.png',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' contourne le cache HTTP du navigateur (10 min sur GitHub Pages) :
  // sans ça, une mise à jour peut mélanger un nouveau app.js et un ancien styles.css.
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.hostname.endsWith('google.com') || url.hostname.endsWith('qrserver.com')) return;
  // config.js change quand le mot de passe change : réseau d'abord, cache en secours.
  if (url.pathname.endsWith('/config.js')) {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit || fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
    )
  );
});

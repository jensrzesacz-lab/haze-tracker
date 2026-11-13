/* Service worker: offline app shell + background PSI check where supported. */
importScripts('./psi-core.js');

var CACHE = 'haze-tracker-v1';
var SHELL = [
  './', './index.html', './styles.css', './app.js', './psi-core.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png',
  './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Same-origin GETs: cache first, refresh in the background. API calls go to the network.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

function checkAndNotify() {
  return Promise.all([HazeCore.getSettings(), HazeCore.getAlertState()]).then(function (r) {
    var settings = r[0], prev = r[1];
    if (!settings.enabled) return;
    return HazeCore.fetchLatest().then(function (data) {
      var value = data.psi24[settings.region];
      var result = HazeCore.evaluate(settings, prev, value);
      return HazeCore.saveAlertState(result.state).then(function () {
        if (result.notify) {
          return self.registration.showNotification(result.title, {
            body: result.body,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            tag: 'haze-alert',
            renotify: true
          });
        }
      });
    });
  }).catch(function () { /* offline or API error: try again next time */ });
}

// Chrome on Android fires this for installed PWAs (frequency decided by the browser).
self.addEventListener('periodicsync', function (e) {
  if (e.tag === 'haze-check') e.waitUntil(checkAndNotify());
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow('./');
  }));
});

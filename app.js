(function () {
  'use strict';
  var C = window.HazeCore;
  var POLL_MS = 5 * 60 * 1000;
  var CACHE_KEY = 'haze-last-data';

  var $ = function (id) { return document.getElementById(id); };
  var settings = Object.assign({}, C.DEFAULT_SETTINGS);
  var lastData = null;
  var swReg = null;
  var deferredInstall = null;

  // ---------- rendering ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
  }

  function render() {
    var grid = $('grid');
    grid.textContent = '';
    var nat = $('national');
    if (!lastData) return;

    var natVal = lastData.psi24.national;
    var natBand = C.bandFor(C.PSI_BANDS, natVal);
    if (natBand) {
      nat.hidden = false;
      nat.style.background = natBand.color;
      nat.textContent = '';
      nat.appendChild(el('span', '', 'Singapore overall'));
      var right = el('span', '');
      right.appendChild(el('span', 'big', String(natVal)));
      right.appendChild(el('span', '', '  ' + natBand.label));
      nat.appendChild(right);
    }

    C.REGIONS.forEach(function (r) {
      var v = lastData.psi24[r];
      var band = C.bandFor(C.PSI_BANDS, v);
      var tile = el('div', 'tile' + (r === settings.region ? ' selected' : ''));
      tile.style.borderTopColor = band ? band.color : 'var(--line)';
      tile.appendChild(el('div', 'name', C.REGION_LABELS[r]));
      tile.appendChild(el('div', 'psi', v === undefined ? '–' : String(v)));
      var b = el('div', 'band', band ? band.label : 'No data');
      if (band) b.style.color = band.color;
      tile.appendChild(b);

      var pm = lastData.pm25 && lastData.pm25[r];
      var pmBand = C.bandFor(C.PM25_BANDS, pm);
      var pmRow = el('div', 'pm');
      pmRow.appendChild(document.createTextNode('1-hr PM2.5 '));
      pmRow.appendChild(el('b', '', pm === undefined || pm === null ? '–' : String(pm)));
      if (pmBand) pmRow.appendChild(document.createTextNode(' · ' + pmBand.label));
      tile.appendChild(pmRow);

      if (settings.enabled && r === settings.region) {
        tile.appendChild(el('span', 'bell', 'Alert ≥ ' + settings.threshold));
      }
      grid.appendChild(tile);
    });

    $('updated').textContent = 'Updated ' + fmtTime(lastData.psiTime);
  }

  function showBanner(msg) {
    var b = $('banner');
    b.hidden = !msg;
    b.textContent = msg || '';
  }

  // ---------- data ----------
  function refresh() {
    var btn = $('refresh');
    btn.classList.add('spin');
    return C.fetchLatest().then(function (data) {
      lastData = data;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
      showBanner('');
      render();
      return checkAlert(data);
    }).catch(function () {
      showBanner(lastData
        ? 'Could not reach NEA. Showing the last data from ' + fmtTime(lastData.psiTime) + '.'
        : 'Could not load PSI data. Check your connection and try again.');
      render();
    }).then(function () { btn.classList.remove('spin'); });
  }

  function checkAlert(data) {
    if (!settings.enabled) return Promise.resolve();
    var value = data.psi24[settings.region];
    return C.getAlertState().then(function (prev) {
      var result = C.evaluate(settings, prev, value);
      return C.saveAlertState(result.state).then(function () {
        if (result.notify) return notify(result.title, result.body);
      });
    });
  }

  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = { body: body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'haze-alert', renotify: true };
    // Android Chrome and iOS only allow notifications via the service worker.
    if ('serviceWorker' in navigator) {
      return navigator.serviceWorker.ready.then(function (reg) { return reg.showNotification(title, opts); });
    }
    new Notification(title, opts);
  }

  // ---------- settings UI ----------
  function updateAlertUI() {
    $('enable').hidden = settings.enabled;
    $('disable').hidden = !settings.enabled;
    var s = $('alertStatus');
    if (!('Notification' in window)) {
      s.textContent = 'This browser does not support notifications.';
      $('enable').disabled = true;
    } else if (Notification.permission === 'denied') {
      s.textContent = 'Notifications are blocked. Allow them in your browser or phone settings, then try again.';
    } else if (settings.enabled) {
      s.textContent = 'Alerts on: ' + C.REGION_LABELS[settings.region] + ', 24-hour PSI of ' +
        settings.threshold + ' or higher.';
    } else {
      s.textContent = 'Alerts are off.';
    }
  }

  function persist() {
    return C.saveSettings(settings).then(function () {
      // Reset crossing state so a changed region or threshold is judged fresh.
      return C.saveAlertState(null);
    }).then(function () {
      render();
      updateAlertUI();
      if (lastData) return checkAlert(lastData);
    });
  }

  function registerBackground() {
    if (!swReg || !swReg.periodicSync) return;
    navigator.permissions.query({ name: 'periodic-background-sync' }).then(function (p) {
      if (p.state === 'granted') return swReg.periodicSync.register('haze-check', { minInterval: 60 * 60 * 1000 });
    }).catch(function () { /* unsupported */ });
  }

  function bindUI() {
    var sel = $('region');
    C.REGIONS.forEach(function (r) {
      var o = el('option', '', C.REGION_LABELS[r]);
      o.value = r;
      sel.appendChild(o);
    });
    sel.value = settings.region;
    $('threshold').value = settings.threshold;
    $('thresholdOut').textContent = settings.threshold;

    sel.addEventListener('change', function () { settings.region = sel.value; persist(); });
    $('threshold').addEventListener('input', function (e) {
      $('thresholdOut').textContent = e.target.value;
    });
    $('threshold').addEventListener('change', function (e) {
      settings.threshold = Number(e.target.value);
      persist();
    });

    $('enable').addEventListener('click', function () {
      if (!('Notification' in window)) return;
      Notification.requestPermission().then(function (perm) {
        settings.enabled = perm === 'granted';
        return persist().then(function () {
          if (settings.enabled) registerBackground();
        });
      });
    });
    $('disable').addEventListener('click', function () { settings.enabled = false; persist(); });
    $('refresh').addEventListener('click', refresh);
    updateAlertUI();
  }

  // ---------- install ----------
  function setupInstall() {
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return;
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      $('installCard').hidden = false;
      $('iosHint').hidden = false;
    }
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstall = e;
      $('installCard').hidden = false;
      $('install').hidden = false;
    });
    $('install').addEventListener('click', function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      deferredInstall.userChoice.then(function () {
        deferredInstall = null;
        $('installCard').hidden = true;
      });
    });
    window.addEventListener('appinstalled', function () { $('installCard').hidden = true; });
  }

  // ---------- boot ----------
  function boot() {
    try {
      var cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cached && cached.psi24) { lastData = cached; render(); }
    } catch (e) { /* ignore */ }

    C.getSettings().catch(function () { return C.DEFAULT_SETTINGS; }).then(function (s) {
      settings = Object.assign({}, C.DEFAULT_SETTINGS, s);
      // Permission may have been revoked outside the app.
      if ('Notification' in window && Notification.permission !== 'granted') settings.enabled = false;
      bindUI();
      setupInstall();
      render();
      return refresh();
    });

    setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh();
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        swReg = reg;
        if (settings.enabled) registerBackground();
      }).catch(function () { /* offline support unavailable */ });
    }
  }

  boot();
})();

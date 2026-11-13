/* Shared logic for the page and the service worker (no DOM access here). */
(function (root) {
  'use strict';

  var API_BASE = 'https://api-open.data.gov.sg/v2/real-time/api/';
  var PSI_URL = API_BASE + 'psi';
  var PM25_URL = API_BASE + 'pm25';

  var REGIONS = ['north', 'south', 'east', 'west', 'central'];
  var REGION_LABELS = {
    north: 'North', south: 'South', east: 'East', west: 'West',
    central: 'Central', national: 'National'
  };

  // NEA 24-hour PSI bands.
  var PSI_BANDS = [
    { max: 50,       key: 'good',      label: 'Good',           color: '#2e9e5b' },
    { max: 100,      key: 'moderate',  label: 'Moderate',       color: '#2f7fd1' },
    { max: 200,      key: 'unhealthy', label: 'Unhealthy',      color: '#e08a00' },
    { max: 300,      key: 'very',      label: 'Very unhealthy', color: '#d6402f' },
    { max: Infinity, key: 'hazardous', label: 'Hazardous',      color: '#8a1f6b' }
  ];

  // NEA 1-hour PM2.5 bands (ug/m3).
  var PM25_BANDS = [
    { max: 55,       key: 'normal',   label: 'Normal',    color: '#2e9e5b' },
    { max: 150,      key: 'elevated', label: 'Elevated',  color: '#e08a00' },
    { max: 250,      key: 'high',     label: 'High',      color: '#d6402f' },
    { max: Infinity, key: 'veryhigh', label: 'Very high', color: '#8a1f6b' }
  ];

  function bandFor(bands, value) {
    if (typeof value !== 'number' || isNaN(value)) return null;
    for (var i = 0; i < bands.length; i++) {
      if (value <= bands[i].max) return bands[i];
    }
    return bands[bands.length - 1];
  }

  /**
   * Pull one reading type out of a data.gov.sg v2 response.
   * Returns { values: {north: n, ...}, timestamp: string|null } or null.
   */
  function extract(json, readingKey) {
    var items = json && json.data && json.data.items;
    if (!items || !items.length) return null;
    var latest = items[items.length - 1];
    var values = latest.readings && latest.readings[readingKey];
    if (!values) return null;
    return { values: values, timestamp: latest.updatedTimestamp || latest.timestamp || null };
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /**
   * Fetch both datasets. PSI is required; PM2.5 is best effort.
   * Resolves to { psi24, pm25, psiTime, pm25Time }.
   */
  function fetchLatest() {
    var psiP = fetchJson(PSI_URL);
    var pmP = fetchJson(PM25_URL).catch(function () { return null; });
    return Promise.all([psiP, pmP]).then(function (res) {
      var psi = extract(res[0], 'psi_twenty_four_hourly');
      if (!psi) throw new Error('Unexpected PSI response');
      var pm = res[1] ? extract(res[1], 'pm25_one_hourly') : null;
      return {
        psi24: psi.values,
        psiTime: psi.timestamp,
        pm25: pm ? pm.values : null,
        pm25Time: pm ? pm.timestamp : null
      };
    });
  }

  var DEFAULT_SETTINGS = { region: 'central', threshold: 100, enabled: false };

  /**
   * Decide whether to notify. A notification fires when the value moves from
   * below the threshold to at/above it (a "crossing"), not on every poll.
   * Returns { notify, title, body, state } where state is the new alert state.
   */
  function evaluate(settings, prevState, value) {
    var above = typeof value === 'number' && value >= settings.threshold;
    var was = prevState && prevState.above;
    var label = REGION_LABELS[settings.region] || settings.region;
    var out = { notify: false, title: '', body: '', state: { above: above, value: value } };
    if (!settings.enabled || typeof value !== 'number') {
      out.state = prevState || out.state;
      return out;
    }
    if (above && was !== true) {
      var band = bandFor(PSI_BANDS, value);
      out.notify = true;
      out.title = 'Haze alert: ' + label + ' PSI ' + value;
      out.body = '24-hour PSI (' + (band ? band.label : '') + ') is at or above your threshold of ' +
        settings.threshold + '.';
    }
    return out;
  }

  // ---- tiny IndexedDB key/value store (shared by page and service worker) ----
  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('haze-tracker', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function kvGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }
  function kvSet(key, value) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getSettings() {
    return kvGet('settings').then(function (s) {
      return Object.assign({}, DEFAULT_SETTINGS, s || {});
    });
  }
  function saveSettings(s) { return kvSet('settings', s); }
  function getAlertState() { return kvGet('alertState'); }
  function saveAlertState(s) { return kvSet('alertState', s); }

  var core = {
    PSI_URL: PSI_URL, PM25_URL: PM25_URL,
    REGIONS: REGIONS, REGION_LABELS: REGION_LABELS,
    PSI_BANDS: PSI_BANDS, PM25_BANDS: PM25_BANDS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    bandFor: bandFor, extract: extract, fetchLatest: fetchLatest, evaluate: evaluate,
    getSettings: getSettings, saveSettings: saveSettings,
    getAlertState: getAlertState, saveAlertState: saveAlertState
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.HazeCore = core;
})(typeof self !== 'undefined' ? self : this);

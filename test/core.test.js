// Run with: node test/core.test.js
const assert = require('assert');
const C = require('../psi-core.js');

// Shape of a data.gov.sg v2 real-time response.
const psiResp = {
  code: 0,
  data: {
    regionMetadata: [],
    items: [{
      date: '2026-11-13', updatedTimestamp: '2026-11-13T11:00:00+08:00', timestamp: '2026-11-13T11:00:00+08:00',
      readings: {
        psi_twenty_four_hourly: { west: 48, national: 55, east: 52, central: 101, south: 60, north: 45 }
      }
    }]
  }
};

const ex = C.extract(psiResp, 'psi_twenty_four_hourly');
assert.strictEqual(ex.values.central, 101);
assert.strictEqual(ex.timestamp, '2026-11-13T11:00:00+08:00');
assert.strictEqual(C.extract(psiResp, 'nope'), null);
assert.strictEqual(C.extract({}, 'x'), null);
assert.strictEqual(C.extract({ data: { items: [] } }, 'x'), null);

// Band edges (NEA: 0-50, 51-100, 101-200, 201-300, >300).
const label = (v) => C.bandFor(C.PSI_BANDS, v).label;
assert.strictEqual(label(0), 'Good');
assert.strictEqual(label(50), 'Good');
assert.strictEqual(label(51), 'Moderate');
assert.strictEqual(label(100), 'Moderate');
assert.strictEqual(label(101), 'Unhealthy');
assert.strictEqual(label(200), 'Unhealthy');
assert.strictEqual(label(201), 'Very unhealthy');
assert.strictEqual(label(300), 'Very unhealthy');
assert.strictEqual(label(301), 'Hazardous');
assert.strictEqual(C.bandFor(C.PSI_BANDS, undefined), null);
const pmLabel = (v) => C.bandFor(C.PM25_BANDS, v).label;
assert.deepStrictEqual([55, 56, 150, 151, 250, 251].map(pmLabel),
  ['Normal', 'Elevated', 'Elevated', 'High', 'High', 'Very high']);

// Crossing logic.
const s = { region: 'central', threshold: 100, enabled: true };
let r = C.evaluate(s, null, 90);
assert.strictEqual(r.notify, false);
assert.strictEqual(r.state.above, false);

r = C.evaluate(s, r.state, 100);            // reaches threshold -> notify
assert.strictEqual(r.notify, true);
assert.ok(/Central PSI 100/.test(r.title));

r = C.evaluate(s, r.state, 130);            // still above -> no repeat
assert.strictEqual(r.notify, false);
assert.strictEqual(r.state.above, true);

r = C.evaluate(s, r.state, 80);             // falls back
assert.strictEqual(r.notify, false);
assert.strictEqual(r.state.above, false);

r = C.evaluate(s, r.state, 120);            // crosses again -> notify
assert.strictEqual(r.notify, true);

// First reading already above threshold notifies once.
assert.strictEqual(C.evaluate(s, null, 150).notify, true);
// Disabled never notifies; missing value never notifies.
assert.strictEqual(C.evaluate({ ...s, enabled: false }, null, 150).notify, false);
assert.strictEqual(C.evaluate(s, null, undefined).notify, false);

// fetchLatest with a mocked fetch; PM2.5 failure is tolerated.
global.fetch = async (url) => {
  if (url === C.PSI_URL) return { ok: true, json: async () => psiResp };
  return { ok: false, status: 500 };
};
C.fetchLatest().then((d) => {
  assert.strictEqual(d.psi24.north, 45);
  assert.strictEqual(d.pm25, null);
  global.fetch = async (url) => url === C.PSI_URL
    ? { ok: true, json: async () => psiResp }
    : { ok: true, json: async () => ({ data: { items: [{ updatedTimestamp: 't', readings: { pm25_one_hourly: { north: 12 } } }] } }) };
  return C.fetchLatest();
}).then((d) => {
  assert.strictEqual(d.pm25.north, 12);
  global.fetch = async () => ({ ok: false, status: 503 });
  return C.fetchLatest().then(() => assert.fail('should reject'), (e) => assert.ok(/HTTP 503/.test(e.message)));
}).then(() => console.log('All tests passed'));

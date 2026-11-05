import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Route mapping: /api/freshness per house climate sensor list; /api/ventilation warmest reading (hotC); /api/sleep-score ?days.
function load(file, mocks, globals = {}) {
  const js = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { module: m, exports: m.exports, require: (n) => { if (!(n in mocks)) throw Error(`Unexpected import ${n}`); return mocks[n]; }, Date, URL, Request, console: { error() {} }, ...globals });
  return m.exports;
}
class FarmAccessError extends Error {}
const T0 = Date.parse('2026-11-02T10:00:00Z');
function route(sensorRows) {
  return load('src/app/api/freshness/route.ts', {
    'next/server': { NextResponse: { json: (body) => ({ body }) } },
    '@/lib/farms': { FarmAccessError, getFarmForRequest: async () => ({ farmId: 'f1', timezoneOffset: 2 }) },
    '@/lib/todayStatus': { mergeThresholds: () => ({}) },
    '@/lib/influxdb': { queryInflux: async (sql) => {
      if (/GROUP BY device_id/.test(sql) && /AM308-1/.test(sql)) { if (sensorRows instanceof Error) throw sensorRows; return sensorRows; }
      if (/AM308-1/.test(sql)) return [{ last: new Date(T0) }];
      return [];
    } },
  });
}

test('freshness: climateSensors per AM308-1 device, named in device-id order', async () => {
  const { body } = await route([{ device_id: 'bbbb000000000002', last: new Date(T0 - 4 * 3600e3) }, { device_id: 'aaaa000000000001', last: new Date(T0) }]).GET();
  assert.deepEqual(JSON.parse(JSON.stringify(body.climateSensors)), [
    { name: 'House sensor 1 (…0001)', lastSeen: new Date(T0).toISOString() },
    { name: 'House sensor 2 (…0002)', lastSeen: new Date(T0 - 4 * 3600e3).toISOString() },
  ]);
});

test('freshness: no climateSensors for a one-sensor house or a failed query', async () => {
  assert.equal((await route([{ device_id: 'aaaa000000000001', last: new Date(T0) }]).GET()).body.climateSensors, undefined);
  assert.equal((await route(new Error('influx down')).GET()).body.climateSensors, undefined);
});

test('ventilation route: inside points carry the warmest reading as hotC', async () => {
  let sql = '';
  const api = load('src/app/api/ventilation/route.ts', {
    'next/server': { NextResponse: { json: (body) => ({ body }) } },
    '@/lib/farms': { FarmAccessError, validLocation: () => null, getFarmForRequest: async () => ({ farmId: 'f1', timezoneOffset: 2 }) },
    '@/lib/ventilation': { mergeVentThresholds: () => ({}), parseOpenMeteo: () => null },
    '@/lib/influxdb': { queryInflux: async (q) => { sql = q; return [{ bucket: new Date(T0), temperature: 30.2, humidity: 50, co2: 800, temperature_max: 32.1 }]; } },
  });
  const { body } = await api.GET();
  assert.match(sql, /MAX\(temperature\) AS temperature_max/);
  assert.deepEqual(JSON.parse(JSON.stringify(body.inside)), [{ t: T0, tempC: 30.2, rhPct: 50, co2: 800, hotC: 32.1 }]);
});

test('sleep-score route: ?days=2 for the Today card, default and out-of-range give 15', async () => {
  const sqls = [];
  const api = load('src/app/api/sleep-score/route.ts', {
    'next/server': { NextResponse: { json: (body) => ({ body }) } },
    '@/lib/farms': { FarmAccessError, getFarmForRequest: async () => ({ farmId: 'f1' }) },
    '@/lib/sleepScore': { nightScores: () => [] },
    '@/lib/influxdb': { queryInflux: async (q) => { sqls.push(q); return []; } },
  });
  const days = async (qs) => { sqls.length = 0; await api.GET(new Request(`http://x/api/sleep-score${qs}`)); return sqls.map((s) => s.match(/interval '(\d+) days'/)[1]); };
  assert.deepEqual(await days('?days=2'), ['2', '2']);
  assert.deepEqual(await days(''), ['15', '15']);
  assert.deepEqual(await days('?days=99'), ['15', '15']);
  assert.deepEqual(await days("?days=2'; DROP"), ['15', '15']);
});

test('ventilation route: forecast fetch has a timeout; a failed forecast still returns the inside readings', async () => {
  let init;
  const api = load('src/app/api/ventilation/route.ts', {
    'next/server': { NextResponse: { json: (body) => ({ body }) } },
    '@/lib/farms': { FarmAccessError, validLocation: () => ({ lat: 1, lon: 2 }), getFarmForRequest: async () => ({ farmId: 'f1', timezoneOffset: 2 }) },
    '@/lib/ventilation': { mergeVentThresholds: () => ({}), parseOpenMeteo: () => null },
    '@/lib/influxdb': { queryInflux: async () => [{ bucket: new Date(T0), temperature: 25, humidity: 50, co2: 800, temperature_max: 26 }] },
  }, { fetch: async (_u, i) => { init = i; throw new DOMException('timed out', 'TimeoutError'); }, AbortSignal });
  const { body } = await api.GET();
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(body.forecastError, true);
  assert.equal(body.inside.length, 1);
});

test('freshness route: 403 without farm access; every query is scoped to the caller farm', async () => {
  const sqls = [];
  const mk = (farm) => load('src/app/api/freshness/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    '@/lib/farms': { FarmAccessError, getFarmForRequest: async () => { if (!farm) throw new FarmAccessError('no access'); return farm; } },
    '@/lib/todayStatus': { mergeThresholds: () => ({}) },
    '@/lib/influxdb': { queryInflux: async (q) => { sqls.push(q); return []; } },
  });
  const denied = await mk(null).GET();
  assert.equal(denied.status, 403);
  assert.equal(sqls.length, 0);
  await mk({ farmId: "f1' OR '1'='1", timezoneOffset: 2, waterMeters: [{ deviceId: 'aaaa000000000001', name: 'Meter 1' }] }).GET();
  assert.ok(sqls.length >= 3);
  for (const q of sqls) assert.match(q, /farm_id = 'f1'' OR ''1''=''1'/); // quotes escaped, never a bare OR
});

test('summary route: heatSparkline is the warmest fresh sensor and is omitted when that query fails', async () => {
  const thi = load('src/lib/thi.ts');
  const legacy = load('src/lib/legacyAlerts.ts', { './thi': thi });
  const today = load('src/lib/todayStatus.ts', { './thi': thi, './legacyAlerts': legacy });
  const now = Date.now();
  const row = (id, mins, temp, readMins = mins) => ({ bucket: new Date(now - mins * 60e3), device_id: id, temperature: temp, read_at: new Date(now - readMins * 60e3) });
  let sql = '';
  const api = (sensor) => load('src/app/api/dashboard/summary/route.ts', {
    'next/server': { NextResponse: { json: (body) => ({ body }) } },
    '@/lib/farms': { FarmAccessError, getFarmForRequest: async () => ({ farmId: 'f1', feedDeviceId: 'bbbb000000000002', waterDeviceId: 'aaaa000000000001' }) },
    '@/lib/influxdb': { queryInflux: async (q) => { if (!/MAX\(time\) AS read_at/.test(q)) return []; sql = q; if (sensor instanceof Error) throw sensor; return sensor; } },
    '@/lib/thresholds': { tempStatus: () => 'normal', humidityStatus: () => 'normal', co2Status: () => 'normal', computeHealth: () => 1, healthLabel: () => 'ok', healthWord: () => 'ok', vpd: () => null },
    '@/lib/meterPoints': { sumMeterPoints: () => [] },
    '@/lib/todayStatus': today,
  });
  const ok = await api([
    row('aaaa000000000001', 30, 28), row('aaaa000000000001', 0, 28),
    row('bbbb000000000002', 30, 33.2), row('bbbb000000000002', 0, 33.4),
    row('cccc000000000003', 30, 40, 120), row('cccc000000000003', 0, 40, 120),
    row('dddd000000000004', 0, 85),
  ]).GET();
  assert.match(sql, /AVG\(temperature\) AS temperature/);
  assert.match(sql, /GROUP BY device_id, bucket/);
  assert.match(sql, /farm_id = 'f1'/);
  assert.deepEqual(JSON.parse(JSON.stringify(ok.body.env.temperature.heatSparkline.map((p) => p.value))), [33.2, 33.4]);
  assert.equal(JSON.stringify(ok.body).includes('cccc000000000003'), false);
  const failed = await api(new Error('down')).GET();
  assert.equal(failed.body.env.temperature.heatSparkline, undefined);
});

test('timeoutSignal: native AbortSignal.timeout or a timer fallback', async () => {
  const T = load('src/lib/timeoutSignal.ts', {}, { AbortSignal, AbortController, setTimeout });
  assert.ok(T.timeoutSignal(1000) instanceof AbortSignal);
  const old = load('src/lib/timeoutSignal.ts', {}, { AbortSignal: { timeout: undefined }, AbortController, setTimeout });
  const s = old.timeoutSignal(5);
  assert.equal(s.aborted, false);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(s.aborted, true);
});

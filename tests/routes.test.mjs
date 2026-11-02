import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Route mapping: /api/freshness per house climate sensor list; /api/ventilation warmest reading (hotC).
function load(file, mocks) {
  const js = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { module: m, exports: m.exports, require: (n) => { if (!(n in mocks)) throw Error(`Unexpected import ${n}`); return mocks[n]; }, Date, URL, console: { error() {} } });
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
    { name: 'House sensor 1', lastSeen: new Date(T0).toISOString() },
    { name: 'House sensor 2', lastSeen: new Date(T0 - 4 * 3600e3).toISOString() },
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

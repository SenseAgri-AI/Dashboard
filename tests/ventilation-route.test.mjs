import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks, globals = {}) {
  const js = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { module: m, exports: m.exports, require: (n) => { if (!(n in mocks)) throw Error(`Unexpected import ${n}`); return mocks[n]; }, Date, URL, Request, console: { error() {} }, ...globals });
  return m.exports;
}
class FarmAccessError extends Error {}
const T0 = Date.parse('2026-11-02T10:00:00Z');

test('ventilation route: inside points carry the warmest reading as hotC and do not read radar or feed', async () => {
  let sql = '';
  const api = load('src/app/api/ventilation/route.ts', {
    'next/server': { NextResponse: { json: (body) => ({ body }) } },
    '@/lib/farms': { FarmAccessError, validLocation: () => null, getFarmForRequest: async () => ({ farmId: 'f1', timezoneOffset: 2 }) },
    '@/lib/ventilation': { mergeVentThresholds: () => ({}), parseOpenMeteo: () => null },
    '@/lib/influxdb': { queryInflux: async (q) => { sql = q; return [{ bucket: new Date(T0), temperature: 30.2, humidity: 50, co2: 800, temperature_max: 32.1 }]; } },
  });
  const { body } = await api.GET();
  assert.match(sql, /MAX\(temperature\) AS temperature_max/);
  assert.match(sql, /device_type = 'AM308-1'/);
  assert.doesNotMatch(sql, /EM300|EM411|radar|feed|pulse|silo/i);
  assert.deepEqual(JSON.parse(JSON.stringify(body.inside)), [{ t: T0, tempC: 30.2, rhPct: 50, co2: 800, hotC: 32.1 }]);
});

test('ventilation route: forecast fetch has a timeout; a failed forecast still returns the inside readings', async () => {
  let init;
  const api = load('src/app/api/ventilation/route.ts', {
    'next/server': { NextResponse: { json: (body) => ({ body }) } },
    '@/lib/farms': { FarmAccessError, validLocation: () => ({ lat: 0, lon: 0 }), getFarmForRequest: async () => ({ farmId: 'f1', timezoneOffset: 2 }) },
    '@/lib/ventilation': { mergeVentThresholds: () => ({}), parseOpenMeteo: () => null },
    '@/lib/influxdb': { queryInflux: async () => [{ bucket: new Date(T0), temperature: 25, humidity: 50, co2: 800, temperature_max: 26 }] },
  }, { fetch: async (_u, i) => { init = i; throw new DOMException('timed out', 'TimeoutError'); }, AbortSignal });
  const { body } = await api.GET();
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(body.forecastError, true);
  assert.equal(body.inside.length, 1);
  assert.deepEqual(body.location, { lat: 0, lon: 0 });
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

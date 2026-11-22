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
const json = (body, init) => ({ body, status: init?.status ?? 200, headers: init?.headers ?? {} });
const noCoords = (body) => {
  assert.equal(Object.hasOwn(body, 'location'), false);
  assert.equal(JSON.stringify(body).includes('"lat"'), false);
  assert.equal(JSON.stringify(body).includes('"lon"'), false);
};

test('ventilation route: inside points carry the warmest reading as hotC and do not read radar or feed', async () => {
  let sql = '';
  const api = load('src/app/api/ventilation/route.ts', {
    'next/server': { NextResponse: { json } },
    '@/lib/farms': { FarmAccessError, validLocation: () => null, getFarmForRequest: async () => ({ farmId: 'f1', timezoneOffset: 2 }) },
    '@/lib/ventilation': { mergeVentThresholds: () => ({}), parseOpenMeteo: () => null },
    '@/lib/influxdb': { queryInflux: async (q) => { sql = q; return [{ bucket: new Date(T0), temperature: 30.2, humidity: 50, co2: 800, temperature_max: 32.1 }]; } },
  });
  const res = await api.GET();
  assert.match(sql, /MAX\(temperature\) AS temperature_max/);
  assert.match(sql, /device_type = 'AM308-1'/);
  assert.match(sql, /INTERVAL '30 days'/);
  assert.match(sql, /INTERVAL '30 minutes'/);
  assert.doesNotMatch(sql, /EM300|EM411|radar|feed|pulse|silo/i);
  assert.equal(res.body.hasLocation, false);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  noCoords(res.body);
  assert.deepEqual(JSON.parse(JSON.stringify(res.body.inside)), [{ t: T0, tempC: 30.2, rhPct: 50, co2: 800, hotC: 32.1 }]);
});

test('ventilation route: forecast fetch has a timeout; a failed forecast still returns the inside readings', async () => {
  let init;
  let url = '';
  const api = load('src/app/api/ventilation/route.ts', {
    'next/server': { NextResponse: { json } },
    '@/lib/farms': { FarmAccessError, validLocation: () => ({ lat: 0, lon: 0 }), getFarmForRequest: async () => ({ farmId: 'f1', timezoneOffset: 2 }) },
    '@/lib/ventilation': { mergeVentThresholds: () => ({}), parseOpenMeteo: () => null },
    '@/lib/influxdb': { queryInflux: async () => [{ bucket: new Date(T0), temperature: 25, humidity: 50, co2: 800, temperature_max: 26 }] },
  }, { fetch: async (u, i) => { url = String(u); init = i; throw new DOMException('timed out', 'TimeoutError'); }, AbortSignal });
  const res = await api.GET();
  assert.ok(init.signal instanceof AbortSignal);
  assert.match(url, /latitude=0&longitude=0/);
  assert.match(url, /past_days=30/);
  assert.equal(res.body.forecastError, true);
  assert.equal(res.body.hasLocation, true);
  assert.equal(res.body.inside.length, 1);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  noCoords(res.body);
});

test('ventilation route: missing session is 403 and a farm lookup failure is 500, both uncached', async () => {
  let queries = 0;
  const denied = load('src/app/api/ventilation/route.ts', {
    'next/server': { NextResponse: { json } },
    '@/lib/farms': { FarmAccessError, validLocation: () => ({ lat: 0, lon: 0 }), getFarmForRequest: async () => { throw new FarmAccessError('no access'); } },
    '@/lib/ventilation': { mergeVentThresholds: () => ({}), parseOpenMeteo: () => null },
    '@/lib/influxdb': { queryInflux: async () => { queries += 1; return []; } },
  });
  const noSession = await denied.GET();
  assert.equal(noSession.status, 403);
  assert.equal(noSession.headers['Cache-Control'], 'private, no-store');
  assert.equal(queries, 0);
  noCoords(noSession.body);

  const broken = load('src/app/api/ventilation/route.ts', {
    'next/server': { NextResponse: { json } },
    '@/lib/farms': { FarmAccessError, validLocation: () => null, getFarmForRequest: async () => { throw new Error('config unavailable'); } },
    '@/lib/ventilation': { mergeVentThresholds: () => ({}), parseOpenMeteo: () => null },
    '@/lib/influxdb': { queryInflux: async () => { queries += 1; return []; } },
  });
  const failed = await broken.GET();
  assert.equal(failed.status, 500);
  assert.equal(failed.headers['Cache-Control'], 'private, no-store');
  assert.equal(queries, 0);
  noCoords(failed.body);
});

test('timeoutSignal: native AbortSignal.timeout or a timer fallback', async () => {
  const T = load('src/lib/timeoutSignal.ts', {}, { AbortSignal, AbortController, setTimeout, clearTimeout });
  assert.ok(T.timeoutSignal(1000) instanceof AbortSignal);
  const old = load('src/lib/timeoutSignal.ts', {}, { AbortSignal: { timeout: undefined }, AbortController, setTimeout, clearTimeout });
  const s = old.timeoutSignal(5);
  assert.equal(s.aborted, false);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(s.aborted, true);
});

test('timeoutSignal fallback clears its timer when the caller aborts', () => {
  let cleared = false;
  const parent = new AbortController();
  const old = load('src/lib/timeoutSignal.ts', {}, {
    AbortSignal: { timeout: undefined },
    AbortController,
    setTimeout: () => 7,
    clearTimeout: (id) => { if (id === 7) cleared = true; },
  });
  const s = old.timeoutSignal(30_000, parent.signal);
  assert.equal(s.aborted, false);
  assert.equal(cleared, false);
  parent.abort();
  assert.equal(s.aborted, true);
  assert.equal(cleared, true);
});

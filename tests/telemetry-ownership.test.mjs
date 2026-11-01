import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(rel, mocks = {}, extra = {}) {
  const src = fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  const require = (name) => {
    if (name in mocks) return mocks[name];
    throw new Error(`unexpected import ${name}`);
  };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require, ...extra });
  return mod.exports;
}

const params = load('src/lib/telemetryParams.ts');

// Fake clock and a mocked Influx that records each query.
function setup(rowsByCall) {
  let now = 1_000_000;
  const calls = [];
  const FakeDate = class extends Date {};
  FakeDate.now = () => now;
  const influx = {
    queryInflux: async (sql) => {
      calls.push(sql);
      const r = rowsByCall[Math.min(calls.length - 1, rowsByCall.length - 1)];
      return r;
    },
  };
  const own = load('src/lib/telemetryOwnership.ts', { '@/lib/influxdb': influx, '@/lib/telemetryParams': params }, { Date: FakeDate });
  return { own, calls, tick: (ms) => { now += ms; } };
}

const FARM = { farmId: 'farm_x_001', waterDeviceId: 'aaaaaaaaaaaaaaaa', feedDeviceId: '' };
const CLIMATE = '0123456789abcdef';

test('a configured device is owned without asking Influx', async () => {
  const { own, calls } = setup([[]]);
  assert.equal(await own.farmOwnsDevice(FARM, 'AAAAAAAAAAAAAAAA'), true);
  assert.equal(calls.length, 0);
});

test('a device reporting under the farm is owned; others are not', async () => {
  const { own, calls } = setup([[{ device_id: CLIMATE.toUpperCase() }]]);
  assert.equal(await own.farmOwnsDevice(FARM, CLIMATE), true);
  assert.equal(await own.farmOwnsDevice(FARM, 'ffffffffffffffff'), false);
  assert.equal(calls.length, 1, 'second lookup served from cache');
  assert.match(calls[0], /farm_id = 'farm_x_001'/);
  assert.match(calls[0], /interval '90 days'/);
});

test('the device list is cached per farm for about 10 minutes', async () => {
  const { own, calls, tick } = setup([[], [{ device_id: CLIMATE }]]);
  assert.equal(own.DEVICE_CACHE_TTL_MS, 10 * 60 * 1000);
  assert.equal(await own.farmOwnsDevice(FARM, CLIMATE), false);
  tick(9 * 60 * 1000);
  assert.equal(await own.farmOwnsDevice(FARM, CLIMATE), false, 'still cached');
  assert.equal(calls.length, 1);
  tick(2 * 60 * 1000);
  assert.equal(await own.farmOwnsDevice(FARM, CLIMATE), true, 'refreshed after TTL');
  assert.equal(calls.length, 2);
  await own.farmOwnsDevice({ ...FARM, farmId: 'farm_y_002' }, CLIMATE);
  assert.equal(calls.length, 3, 'another farm has its own entry');
  assert.match(calls[2], /farm_id = 'farm_y_002'/);
  own.clearDeviceCache();
  await own.farmOwnsDevice(FARM, CLIMATE);
  assert.equal(calls.length, 4);
});

test('malformed farm or device ids are refused before any query', async () => {
  const { own, calls } = setup([[{ device_id: CLIMATE }]]);
  assert.equal(await own.farmOwnsDevice({ ...FARM, farmId: "x' OR '1'='1" }, CLIMATE), false);
  assert.equal(await own.farmOwnsDevice(FARM, `${CLIMATE}'`), false);
  assert.equal(calls.length, 0);
});

test('a failed lookup is not cached', async () => {
  let n = 0;
  const influx = { queryInflux: async () => { n += 1; if (n === 1) throw new Error('down'); return [{ device_id: CLIMATE }]; } };
  const own = load('src/lib/telemetryOwnership.ts', { '@/lib/influxdb': influx, '@/lib/telemetryParams': params });
  await assert.rejects(own.farmOwnsDevice(FARM, CLIMATE));
  assert.equal(await own.farmOwnsDevice(FARM, CLIMATE), true);
});

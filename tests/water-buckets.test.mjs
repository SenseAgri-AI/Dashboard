import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const js = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: () => { throw new Error('no imports'); },
    Date, Math, Number, JSON, console, isNaN,
  });
  return mod.exports;
}

const {
  bucketWaterConsumption, cumulativeMeterPoints, isSafeDeviceId, litresPerBucketLabel, positivePulseLitres, resolveWaterMeters,
} = load('src/lib/meterConsumption.ts');

const T1 = '2026-11-02T08:00:00.000Z';
const T2 = '2026-11-02T08:15:00.000Z';
const T3 = '2026-11-02T08:30:00.000Z';
// Values cross a vm boundary, so compare JSON rather than object identity.
const json = (value) => JSON.stringify(value);

test('two meters are differenced separately and summed per bucket', () => {
  const buckets = bucketWaterConsumption([
    { deviceId: 'meter-a', name: 'Meter 1', litresPerPulse: 10, readings: [
      { time: T1, cumulative: 100 }, { time: T2, cumulative: 110 }, { time: T3, cumulative: 112 },
    ] },
    { deviceId: 'meter-b', name: 'Meter 2', litresPerPulse: 10, readings: [
      { time: T1, cumulative: 5 }, { time: T2, cumulative: 8 }, { time: T3, cumulative: 8 },
    ] },
  ]);
  assert.equal(json(buckets.map((b) => [b.time, b.total])), json([[T2, 130], [T3, 20]]));
  assert.equal(json(buckets[0].byMeter.map((m) => m.litres)), json([100, 30]));
  assert.equal(buckets[0].total, 100 + 30);
  // Unchanged counter is 0 litres, which is different from a missing bucket (null).
  assert.equal(json(buckets[1].byMeter.map((m) => m.litres)), json([20, 0]));
  // A cross-meter diff (110 − 5, or 8 − 100) would not be 130.
  assert.notEqual(buckets[0].total, positivePulseLitres(5, 110, 10));
});

test('a counter reset or negative diff is 0 litres and becomes the next baseline', () => {
  const buckets = bucketWaterConsumption([
    { deviceId: 'meter-a', name: 'Meter 1', litresPerPulse: 10, readings: [
      { time: T1, cumulative: 100 }, { time: T2, cumulative: 40 }, { time: T3, cumulative: 45 },
    ] },
  ]);
  assert.equal(json(buckets.map((b) => b.total)), json([0, 50]));
  assert.equal(buckets[1].byMeter[0].litres, positivePulseLitres(40, 45, 10));
});

test('a missing bucket on one meter is omitted, and that meter stays on its own counter', () => {
  const buckets = bucketWaterConsumption([
    { deviceId: 'meter-a', name: 'A-frame 1', litresPerPulse: 10, readings: [
      { time: T1, cumulative: 0 }, { time: T2, cumulative: 2 }, { time: T3, cumulative: 5 },
    ] },
    { deviceId: 'meter-b', name: 'A-frame 2', litresPerPulse: 10, readings: [
      { time: T1, cumulative: 0 },
      // no T2 row
      { time: T3, cumulative: 4 },
    ] },
  ]);
  const t2 = buckets.find((b) => b.time === T2);
  const t3 = buckets.find((b) => b.time === T3);
  assert.equal(t2.total, 20);
  assert.equal(t2.byMeter[0].litres, 20);
  assert.equal(t2.byMeter[1].litres, null);
  // Meter B's step is 4 − 0, not 4 − meter A's counter, and not a filled-in zero at T2.
  assert.equal(t3.byMeter[1].litres, 40);
  assert.equal(t3.byMeter[0].litres, 30);
  assert.equal(t3.total, 70);
});

test('bucket totals match the summary helper applied to each meter', () => {
  const a = [{ bucket: T1, cumulative: 10 }, { bucket: T2, cumulative: 12 }];
  const b = [{ bucket: T1, cumulative: 3 }, { bucket: T2, cumulative: 7 }];
  const buckets = bucketWaterConsumption([
    { deviceId: 'a', name: 'A', litresPerPulse: 10, readings: a.map((r) => ({ time: r.bucket, cumulative: r.cumulative })) },
    { deviceId: 'b', name: 'B', litresPerPulse: 10, readings: b.map((r) => ({ time: r.bucket, cumulative: r.cumulative })) },
  ]);
  const summed = cumulativeMeterPoints(a, 10)[0].value + cumulativeMeterPoints(b, 10)[0].value;
  assert.equal(buckets[0].total, summed);
  assert.equal(cumulativeMeterPoints(a, 10)[0].cumulative, 20);
});

test('resolveWaterMeters falls back to waterDeviceId when waterMeters is absent or empty', () => {
  assert.equal(json(resolveWaterMeters({ waterDeviceId: 'abc123' })), json([{ deviceId: 'abc123', name: 'Meter 1' }]));
  assert.equal(json(resolveWaterMeters({ waterMeters: [], waterDeviceId: 'abc123' })), json([{ deviceId: 'abc123', name: 'Meter 1' }]));
  assert.equal(json(resolveWaterMeters({ waterMeters: null, waterDeviceId: 'abc123' })), json([{ deviceId: 'abc123', name: 'Meter 1' }]));
  assert.equal(json(resolveWaterMeters({})), json([]));
  assert.equal(json(resolveWaterMeters({ waterDeviceId: '  ' })), json([]));
  const configured = resolveWaterMeters({
    waterDeviceId: 'ignored',
    waterMeters: [
      { deviceId: ' aaa ', name: 'North' },
      { deviceId: 'aaa', name: 'duplicate' },
      { deviceId: 'bbb', name: '' },
    ],
  });
  assert.equal(json(configured), json([
    { deviceId: 'aaa', name: 'North' },
    { deviceId: 'bbb', name: 'Meter 3' },
  ]));
});

test('a waterMeters list with no usable id falls back to waterDeviceId', () => {
  assert.equal(json(resolveWaterMeters({
    waterMeters: [{ deviceId: '  ' }, { deviceId: '' }],
    waterDeviceId: 'abc123',
  })), json([{ deviceId: 'abc123', name: 'Meter 1' }]));
  assert.equal(json(resolveWaterMeters({
    waterMeters: [{ deviceId: 'bad id' }, { deviceId: 'nope!' }],
    waterDeviceId: 'abc123',
  }, isSafeDeviceId)), json([{ deviceId: 'abc123', name: 'Meter 1' }]));
  assert.equal(json(resolveWaterMeters({
    waterMeters: [{ deviceId: 'good123', name: 'North' }, { deviceId: 'bad id' }],
    waterDeviceId: 'fallback99',
  }, isSafeDeviceId)), json([{ deviceId: 'good123', name: 'North' }]));
  assert.equal(json(resolveWaterMeters({
    waterMeters: [{ deviceId: 'bad id' }],
    waterDeviceId: 'also bad',
  }, isSafeDeviceId)), json([]));
});

test('litresPerBucketLabel follows the bucket that was queried', () => {
  assert.equal(litresPerBucketLabel('15 minutes'), 'L per 15 min');
  assert.equal(litresPerBucketLabel('15m'), 'L per 15 min');
  assert.equal(litresPerBucketLabel('1 hour'), 'L per 1 h');
  assert.equal(litresPerBucketLabel('3 hours'), 'L per 3 h');
});

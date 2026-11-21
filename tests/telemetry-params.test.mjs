import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/telemetryParams.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports });
const T = mod.exports;
const plain = (v) => JSON.parse(JSON.stringify(v));
const DEV = '0123456789abcdef';

test('accepts known device types, metrics and 16-hex device ids', () => {
  assert.deepEqual(plain(T.checkTelemetryParams({ deviceId: DEV, deviceType: 'AM308-1' }, false)),
    { ok: true, deviceId: DEV, deviceType: 'AM308-1', metric: null });
  assert.deepEqual(plain(T.checkTelemetryParams({ deviceId: DEV.toUpperCase(), deviceType: 'EM300-1', metric: 'pulse_total' }, true)),
    { ok: true, deviceId: DEV, deviceType: 'EM300-1', metric: 'pulse_total' });
});

test('missing params are a 400 with the original message', () => {
  const r = T.checkTelemetryParams({ deviceId: DEV, deviceType: 'AM308-1', metric: null }, true);
  assert.equal(r.ok, false); assert.equal(r.status, 400);
  assert.equal(r.error, 'device_id, device_type, and metric required');
  assert.equal(T.checkTelemetryParams({ deviceId: null, deviceType: 'AM308-1' }, false).error, 'device_id and device_type required');
});

test('device_type must be on the allowlist', () => {
  for (const t of ['EM411-RDL', 'am308-1', 'AM308-1 ', "AM308-1' --", 'constructor', '__proto__']) {
    const r = T.checkTelemetryParams({ deviceId: DEV, deviceType: t }, false);
    assert.equal(r.ok, false, t); assert.equal(r.status, 400);
  }
});

test('metric must be on the allowlist for that device type', () => {
  assert.equal(T.checkTelemetryParams({ deviceId: DEV, deviceType: 'AM308-1', metric: 'co2' }, true).ok, true);
  for (const m of ['pulse_total', 'co2)', 'temperature, humidity', '*', 'time', 'length']) {
    assert.equal(T.checkTelemetryParams({ deviceId: DEV, deviceType: 'AM308-1', metric: m }, true).ok, false, m);
  }
  assert.equal(T.checkTelemetryParams({ deviceId: DEV, deviceType: 'EM300-1', metric: 'temperature' }, true).ok, false);
});

test('device_id must be exactly 16 hex digits', () => {
  for (const id of ['0123456789abcde', '0123456789abcdef0', '0123456789abcdeg', `${DEV}'`, ` ${DEV}`, `${DEV}\n`]) {
    assert.equal(T.checkTelemetryParams({ deviceId: id, deviceType: 'AM308-1' }, false).ok, false, JSON.stringify(id));
  }
});

test('ownership: device must be one of the farm\'s devices', () => {
  const owned = T.configDeviceIds({ waterDeviceId: 'AAAABBBBCCCCDDDD', feedDeviceId: '' });
  assert.deepEqual(plain(owned), ['aaaabbbbccccdddd']);
  assert.equal(T.deviceBelongsToFarm('aaaabbbbccccdddd', owned), true);
  assert.equal(T.deviceBelongsToFarm(DEV, owned), false);
  assert.equal(T.deviceBelongsToFarm(DEV, ['ffffffffffffffff', DEV.toUpperCase()]), true);
  assert.equal(T.deviceBelongsToFarm(DEV, []), false);
});

test('farm id format', () => {
  assert.equal(T.isValidFarmId('farm_x_001'), true);
  assert.equal(T.isValidFarmId("farm' OR 1=1"), false);
  assert.equal(T.isValidFarmId(''), false);
});

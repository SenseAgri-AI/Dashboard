import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const src = fs.readFileSync(new URL('../src/lib/farms.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
const stubs = { '@aws-sdk/client-ssm': {}, '@clerk/nextjs/server': {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, process: { env: {} }, require: (n) => {
  if (n in stubs) return stubs[n];
  throw new Error(`unexpected import ${n}`);
} });
const F = mod.exports;
const ok = { farmId: 'farm_x_001', waterDeviceId: '0123456789abcdef', feedDeviceId: '' };

test('farmId format', () => {
  assert.equal(F.isValidFarmId('farm_x_001'), true);
  assert.equal(F.isValidFarmId('farm-x'), true);
  for (const id of ['', 'Farm_X', "farm' OR '1'='1", 'farm x', 'a'.repeat(65), null, 42]) {
    assert.equal(F.isValidFarmId(id), false, String(id));
  }
});

test('farm config device ids must be 16-hex devEUIs (or empty)', () => {
  assert.equal(F.farmConfigIdProblem(ok), null);
  assert.equal(F.farmConfigIdProblem({ ...ok, feedDeviceId: 'ABCDEF0123456789' }), null);
  assert.equal(F.farmConfigIdProblem({ ...ok, waterDeviceId: "x' OR '1'='1" }), 'invalid waterDeviceId');
  assert.equal(F.farmConfigIdProblem({ ...ok, feedDeviceId: '0123456789abcde' }), 'invalid feedDeviceId');
  assert.equal(F.farmConfigIdProblem({ ...ok, waterMeters: [{ deviceId: '0123456789abcdef', name: 'A' }] }), null);
  assert.equal(F.farmConfigIdProblem({ ...ok, waterMeters: [{ deviceId: 'nope', name: 'A' }] }), 'invalid waterMeters deviceId');
  assert.equal(F.farmConfigIdProblem({ ...ok, waterMeters: 'x' }), 'invalid waterMeters deviceId');
  assert.equal(F.farmConfigIdProblem({ ...ok, farmId: 'Bad Id' }), 'invalid farmId');
});

test('the config load point and admin save both run the id check', () => {
  assert.match(src, /JSON\.parse\(raw\) as FarmConfig;\s*const problem = farmConfigIdProblem\(cfg\);\s*if \(problem\) throw new FarmAccessError/);
  const admin = fs.readFileSync(new URL('../src/app/api/admin/orgs/route.ts', import.meta.url), 'utf8');
  assert.match(admin, /isValidFarmId\(farmConfig\.farmId\)/);
  assert.match(admin, /farmConfigIdProblem\(farmConfig\)/);
});

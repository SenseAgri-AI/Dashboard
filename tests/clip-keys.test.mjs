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

// ---- clip keys ----
const clips = load('src/lib/clipKeys.ts');
const stubs = { '@aws-sdk/client-s3': { S3Client: class {}, ListObjectsV2Command: class {}, GetObjectCommand: class {} }, '@aws-sdk/s3-request-presigner': {}, './influxdb': {}, './clipKeys': clips };
const egg = load('src/lib/eggCountSource.ts', stubs, { process: { env: {} } });

test('acoustic clip keys must start with the farm\'s own path', () => {
  const P = 'events/audio/';
  assert.equal(clips.isKeyUnderFarm(P, 'farm_x_001', 'events/audio/farm_id=farm_x_001/house_id=h1/date=2026-01-01/a.wav'), true);
  for (const k of [
    'events/audio/other/farm_id=farm_x_001/a.wav',
    'events/audio/farm_id=farm_y_002/x/farm_id=farm_x_001/a.wav',
    'events/audio/farm_id=farm_x_0012/a.wav',
    'events/audio/farm_id=farm_x_001/../farm_id=farm_y_002/a.wav',
    'clips/farm_id=farm_x_001/a.wav',
    '',
  ]) assert.equal(clips.isKeyUnderFarm(P, 'farm_x_001', k), false, k);
  assert.equal(clips.isKeyUnderFarm(P, 'farm/x', 'events/audio/farm_id=farm/x/a.wav'), false);
});

test('isFarmClipKey: egg clips must start with clips/farm_id=<id>/ and be .mp4', () => {
  assert.equal(egg.isFarmClipKey('farm_x_001', 'clips/farm_id=farm_x_001/camera_id=cam_001/date=2026-01-01/job_id=no_job/1_u.mp4'), true);
  assert.equal(egg.isFarmClipKey('farm_x_001', 'clips/farm_id=farm_y_002/farm_id=farm_x_001/1_u.mp4'), false);
  assert.equal(egg.isFarmClipKey('farm_x_001', 'clips/x/farm_id=farm_x_001/1_u.mp4'), false);
  assert.equal(egg.isFarmClipKey('farm_x_001', 'clips/farm_id=farm_x_001/1_u.wav'), false);
  assert.equal(egg.isFarmClipKey('farm_x_001', 'clips/farm_id=farm_x_001/../farm_id=farm_y_002/1_u.mp4'), false);
});

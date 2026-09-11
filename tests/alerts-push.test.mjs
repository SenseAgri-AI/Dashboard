import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks = {}) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: (name) => {
    if (!(name in mocks)) throw Error(`Unexpected import ${name}`);
    return mocks[name];
  }, process, Buffer, URL, Date, console: { error() {} } });
  return module.exports;
}
const presentation = load('src/lib/alerts.ts');
const validation = load('src/lib/pushValidation.ts');
const row = { farm_id: 'trusted-farm', alert_id: 'heat_stress#2026-09-11', state: 'firing', severity: 'danger', category: 'climate', title: 'Heat stress', message: 'Check cooling', first_seen: '2026-09-11T06:00:00Z' };
const heartbeat = () => ({ alert_id: '_status#notifier', status: 'ok', last_checked: new Date().toISOString() });
class FarmAccessError extends Error {}

function reader(pages, farmError) {
  const queries = [];
  const api = load('src/app/api/alerts/route.ts', {
    'next/server': { NextResponse: Response },
    '@aws-sdk/client-dynamodb': { DynamoDBClient: class {} },
    '@aws-sdk/lib-dynamodb': {
      QueryCommand: class { constructor(input) { this.input = input; } },
      DynamoDBDocumentClient: { from: () => ({ send: async (command) => {
        queries.push(command.input);
        const page = pages.shift();
        if (page instanceof Error) throw page;
        return page;
      } }) },
    },
    '@/lib/farms': { FarmAccessError, getFarmForRequest: async () => {
      if (farmError) throw farmError;
      return { farmId: 'trusted-farm', houseHens: {} };
    } },
    '@/lib/alerts': presentation,
    '@/lib/legacyAlertReader': { readLegacyAlerts: async () => ({ alerts: [], source: 'legacy' }) },
    '@/lib/acousticSource': { fetchAnomalies: async () => [] },
  });
  return { ...api, queries };
}

test('reader queries the authenticated farm and follows empty filtered pages', async () => {
  const api = reader([{ Items: [], LastEvaluatedKey: { farm_id: 'trusted-farm', alert_id: 'old' } }, { Items: [row, heartbeat()] }]);
  const res = await api.GET();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.alerts.length, 1);
  assert.equal(data.alerts[0].id, row.alert_id);
  assert.equal(data.stale, false);
  assert.equal(api.queries.length, 2);
  assert.equal(api.queries[0].ExpressionAttributeValues[':farm'], 'trusted-farm');
  assert.equal(api.queries[1].ExclusiveStartKey.alert_id, 'old');
});
test('unauthorized farm does not query storage', async () => {
  const api = reader([], new FarmAccessError('No farm'));
  assert.equal((await api.GET()).status, 403);
  assert.equal(api.queries.length, 0);
});
test('cutover uses legacy evaluation only before the first writer heartbeat', async () => {
  const before = await reader([{ Items: [] }]).GET();
  assert.equal((await before.json()).source, 'legacy');
  process.env.ALERTS_REQUIRE_SHARED = 'true';
  try { assert.equal((await reader([{ Items: [] }]).GET()).status, 503); }
  finally { delete process.env.ALERTS_REQUIRE_SHARED; }
  const unavailable = await reader([new Error('AccessDenied')]).GET();
  assert.equal((await unavailable.json()).source, 'legacy');
  process.env.ALERTS_REQUIRE_SHARED = 'true';
  try { assert.equal((await reader([new Error('AccessDenied')]).GET()).status, 503); }
  finally { delete process.env.ALERTS_REQUIRE_SHARED; }
});
test('stale and partial checks are reported with the last known alerts', async () => {
  const res = await reader([{ Items: [row, { ...heartbeat(), last_checked: '2000-01-01T00:00:00Z', status: 'partial' }] }]).GET();
  const data = await res.json();
  assert.equal(data.stale, true);
  assert.equal(data.partial, true);
  assert.equal(data.alerts.length, 1);
});
test('resolved, control, and malformed rows are not presented as firing alerts', () => {
  for (const invalid of [{ ...row, state: 'resolved' }, heartbeat(), { ...row, severity: 'unknown' }, { ...row, title: null }]) {
    assert.equal(presentation.storedAlert(invalid), null);
  }
});
test('push endpoint validation rejects internal URLs and hostname tricks', () => {
  for (const endpoint of ['http://fcm.googleapis.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://fcm.googleapis.com.attacker.test/a', 'https://fcm.googleapis.com@attacker.test/a', 'https://fcm.googleapis.com:8443/a', 'https://169.254.169.254/latest/meta-data']) {
    assert.equal(validation.validPushEndpoint(endpoint), false, endpoint);
  }
  for (const endpoint of ['https://fcm.googleapis.com/a', 'https://web.push.apple.com/a', 'https://updates.push.services.mozilla.com/a']) {
    assert.equal(validation.validPushEndpoint(endpoint), true, endpoint);
  }
});
test('subscription keys require the Web Push wire format', () => {
  const good = { endpoint: 'https://fcm.googleapis.com/a', keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') } };
  assert.equal(validation.validSubscription(good), true);
  assert.equal(validation.validSubscription({ ...good, keys: { ...good.keys, auth: 'short' } }), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks = {}, globals = {}) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: (name) => {
    if (!(name in mocks)) throw Error(`Unexpected import ${name}`);
    return mocks[name];
  }, process, Buffer, URL, Date, setTimeout, clearTimeout, console: { error() {} }, ...globals });
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

const device = { farmId: 'farm', userId: 'user', endpoint: 'https://fcm.googleapis.com/device', keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') } };
function sender(item, failure) {
  const queries = [], sends = [], deletes = [];
  class QueryCommand { constructor(input) { this.input = input; } }
  class DeleteCommand { constructor(input) { this.input = input; } }
  const api = load('src/lib/push.ts', {
    '@aws-sdk/client-dynamodb': { DynamoDBClient: class {} },
    '@aws-sdk/lib-dynamodb': { QueryCommand, DeleteCommand, PutCommand: class {}, DynamoDBDocumentClient: { from: () => ({ send: async command => {
      if (command instanceof DeleteCommand) { deletes.push(command.input); return {}; }
      queries.push(command.input); return { Items: item ? [item] : [] };
    } }) } },
    './pushValidation': validation,
    'web-push': { default: { setVapidDetails() {}, async sendNotification(...args) { sends.push(args); if (failure) throw failure; } } },
  });
  return { ...api, queries, sends, deletes };
}
test('device test queries exactly one endpoint and checks farm and user ownership', async () => {
  const names = ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
  const previous = names.map(name => process.env[name]);
  names.forEach(name => { process.env[name] = 'test-only'; });
  try {
    const api = sender(device);
    assert.equal(await api.sendToDevice('farm', 'user', device.endpoint, { title: 'test', body: 'test' }), 'accepted');
    assert.equal(api.sends.length, 1);
    assert.equal(api.sends[0][0].endpoint, device.endpoint);
    assert.equal(api.queries[0].KeyConditionExpression, 'farmId = :farm AND endpoint = :endpoint');
    assert.equal(api.queries[0].ExpressionAttributeValues[':endpoint'], device.endpoint);
    for (const item of [null, { ...device, userId: 'other' }, { ...device, farmId: 'other' }, { ...device, endpoint: 'https://fcm.googleapis.com/other' }]) {
      const rejected = sender(item);
      assert.equal(await rejected.sendToDevice('farm', 'user', device.endpoint, {}), 'not-found');
      assert.equal(rejected.sends.length, 0);
    }
    const expired = sender(device, { statusCode: 410 });
    assert.equal(await expired.sendToDevice('farm', 'user', device.endpoint, {}), 'expired');
    assert.equal(expired.deletes[0].ExpressionAttributeValues[':user'], 'user');
    const failed = sender(device, Error('transport failed'));
    await assert.rejects(failed.sendToDevice('farm', 'user', device.endpoint, {}), /transport failed/);
  } finally { names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }); }
});

test('test route fails closed for old clients and scopes valid tests to authenticated identity', async () => {
  const calls = [];
  let userId = 'user';
  const api = load('src/app/api/push/test/route.ts', {
    'next/server': { NextResponse: Response },
    '@clerk/nextjs/server': { auth: async () => ({ userId }) },
    '@/lib/farms': { FarmAccessError, getFarmForRequest: async () => ({ farmId: 'farm' }) },
    '@/lib/pushValidation': validation,
    '@/lib/push': { sendToDevice: async (...args) => { calls.push(args); return 'accepted'; } },
  });
  const request = body => new Request('https://example.test/api/push/test', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await api.POST(request({}))).status, 400);
  assert.equal(calls.length, 0);
  const testId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const body = { endpoint: device.endpoint, testId, farmId: 'attacker', userId: 'attacker' };
  const res = await api.POST(request(body));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).accepted, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['farm', 'user', device.endpoint]);
  assert.equal(calls[0][3].tag, `senseagri-test-${testId}`);
  userId = null;
  assert.equal((await api.POST(request(body))).status, 401);
  assert.equal(calls.length, 1);
});

test('receipt watcher captures fast responses, ignores unrelated tests, and cleans up', async () => {
  const { watchPushTest } = load('src/lib/pushTest.ts');
  const listeners = new Set();
  const worker = { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const emit = (testId, status) => { for (const fn of listeners) fn({ data: { type: 'senseagri-push-test', testId, status } }); };
  const watch = watchPushTest(worker, 'ours');
  emit('other', 'displayed');
  assert.equal(listeners.size, 1);
  emit('ours', 'displayed');
  assert.equal(await watch.result, 'displayed');
  assert.equal(listeners.size, 0);
  const timeout = watchPushTest(worker, 'timeout', 1);
  assert.equal(await timeout.result, 'timeout');
  const cancelled = watchPushTest(worker, 'cancel');
  cancelled.cancel();
  assert.equal(await cancelled.result, 'cancelled');
  assert.equal(listeners.size, 0);
});

test('service worker confirms receipt after display attempt and reports display failures', async () => {
  const handlers = {}, receipts = [];
  let release, fail = false;
  const self = {
    addEventListener: (name, fn) => { handlers[name] = fn; },
    registration: { showNotification: () => fail ? Promise.reject(Error('blocked')) : new Promise(resolve => { release = resolve; }) },
    clients: { matchAll: async () => [{ postMessage: message => receipts.push(message) }] },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self });
  let done;
  const push = data => handlers.push({ data: { json: () => data }, waitUntil: promise => { done = promise; } });
  push({ title: 'Test', testId: 'ours' });
  assert.equal(receipts.length, 0);
  release(); await done;
  assert.equal(receipts[0].status, 'displayed');
  assert.equal(receipts[0].testId, 'ours');
  fail = true;
  push({ testId: 'failed' }); await done;
  assert.equal(receipts[1].status, 'display-failed');
  fail = false;
  push({ title: 'Regular farm alert' }); release(); await done;
  assert.equal(receipts.length, 2);
});

test('device registration respects permission, reuses subscriptions and surfaces save failures', async () => {
  const calls = [];
  let permission = 'denied', stored = true, saveOk = true;
  const sub = { toJSON: () => ({ endpoint: device.endpoint, keys: device.keys }) };
  const { registerPushDevice } = load('src/lib/pushRegistration.ts', {}, {
    Notification: { get permission() { return permission; } }, atob,
    navigator: { serviceWorker: {
      register: async () => { calls.push('register'); },
      ready: Promise.resolve({ pushManager: {
        getSubscription: async () => stored ? sub : null,
        subscribe: async () => { calls.push('subscribe'); return sub; },
      } }),
    } },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: saveOk }; },
  });
  await registerPushDevice('AQ');
  assert.equal(calls.length, 0);
  permission = 'default';
  await registerPushDevice('AQ');
  assert.equal(calls.length, 0);
  permission = 'granted';
  await registerPushDevice('AQ');
  assert.equal(calls.includes('subscribe'), false);
  assert.equal(calls[1].url, '/api/push/subscribe');
  assert.equal(JSON.parse(calls[1].options.body).subscription.endpoint, device.endpoint);
  stored = false;
  await registerPushDevice('AQ');
  assert.equal(calls.includes('subscribe'), true);
  const before = calls.length;
  const controller = new AbortController(); controller.abort();
  await registerPushDevice('AQ', controller.signal);
  assert.equal(calls.length, before);
  saveOk = false;
  await assert.rejects(registerPushDevice('AQ'), /Couldn't enable/);
});

test('toggle registration is persisted per user, farm and device; off survives a reload', async () => {
  let row;
  const writes = [];
  const api = load('src/app/api/push/subscribe/route.ts', {
    'next/server': { NextResponse: Response },
    '@clerk/nextjs/server': { auth: async () => ({ userId: 'user' }) },
    '@/lib/farms': { FarmAccessError, getFarmForRequest: async () => ({ farmId: 'farm' }) },
    '@/lib/pushValidation': validation,
    '@/lib/push': {
      saveSubscription: async (farmId, userId, sub) => { row = { farmId, userId, ...sub }; },
      deleteSubscription: async (...args) => { writes.push(args); row = null; },
      getFarmSubscriptions: async () => row ? [row] : [],
    },
  });
  const req = body => ({ json: async () => body });
  const status = () => api.GET({ nextUrl: new URL(`https://example.test/api/push/subscribe?endpoint=${encodeURIComponent(device.endpoint)}`) });
  assert.equal((await (await status()).json()).subscribed, false);
  assert.equal((await api.POST(req({ subscription: device, farmId: 'other', userId: 'other' }))).status, 200);
  assert.equal(row.farmId, 'farm'); assert.equal(row.userId, 'user');
  assert.equal((await (await status()).json()).subscribed, true);
  assert.equal((await api.DELETE(req({ endpoint: device.endpoint }))).status, 200);
  assert.deepEqual(writes, [['farm', device.endpoint, 'user']]);
  assert.equal((await (await status()).json()).subscribed, false);
});

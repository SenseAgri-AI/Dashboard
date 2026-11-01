import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks = {}) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (name) => {
    if (!(name in mocks)) throw Error(`Unexpected import ${name}`);
    return mocks[name];
  }, Date, Math, Number, JSON, console });
  return mod.exports;
}
const F = load('src/lib/feedSanity.ts');
const plain = (v) => JSON.parse(JSON.stringify(v));

test('delivery weights: kg, tonnes, thousands separators; bags need a bag size', () => {
  assert.deepEqual(plain(F.parseFeedWeightKg('25 000 kg')), { kg: 25000, issue: null });
  assert.deepEqual(plain(F.parseFeedWeightKg('25,000kg')), { kg: 25000, issue: null });
  assert.deepEqual(plain(F.parseFeedWeightKg('16t')), { kg: 16000, issue: null });
  assert.deepEqual(plain(F.parseFeedWeightKg('2.5 tonnes')), { kg: 2500, issue: null });
  assert.deepEqual(plain(F.parseFeedWeightKg('25000')), { kg: 25000, issue: 'no-unit' });
  assert.deepEqual(plain(F.parseFeedWeightKg('300 bags')), { kg: null, issue: 'bags' });
  assert.deepEqual(plain(F.parseFeedWeightKg('300 bags', 50)), { kg: 15000, issue: null });
  assert.equal(F.parseFeedWeightKg('about a truck').issue, 'unreadable');
  assert.equal(F.parseFeedWeightKg('').issue, 'empty');
});

test('save-time warning catches unit slips', () => {
  const hens = 4479; // ~500 kg/day at 112 g
  assert.equal(F.deliveryWarning('25 000 kg', hens), null);
  assert.match(F.deliveryWarning('500 kg', hens), /about 1 days?|less than a day/);
  assert.match(F.deliveryWarning('25', hens), /check the units/);           // tonnes typed as kg
  assert.match(F.deliveryWarning('250 000 kg', hens), /check the units/);   // extra zero
  assert.match(F.deliveryWarning('300 bags', hens), /in kg/);
  assert.match(F.deliveryWarning('25000', hens), /Assumed kg/);
  assert.equal(F.deliveryWarning('', hens), null);
});

test('intake between deliveries: normal, low, and a missed delivery flagged as looks wrong', () => {
  const hens = 4479;
  const rows = [
    { date: '2025-12-10', weight: '25000 kg' },
    { date: '2026-01-29', weight: '25000 kg' }, // 50 days → ~112 g
    { date: '2026-04-04', weight: '25000 kg' }, // 65 days → ~86 g (low)
    { date: '2026-09-03', weight: '16000 kg' }, // 152 days → ~37 g: a delivery wasn't logged
    { date: '2026-10-29', weight: '25 t' },
  ];
  const out = plain(F.intakeBetweenDeliveries(rows, hens));
  assert.deepEqual(out.map((x) => [x.date, x.days, x.gPerHenDay, x.verdict]), [
    ['2025-12-10', 50, 112, 'normal'],
    ['2026-01-29', 65, 86, 'low'],
    ['2026-04-04', 152, 37, 'looks-wrong'],
    ['2026-09-03', 56, 64, 'looks-wrong'],
  ]);
  // same-day deliveries add up; unreadable weights break the chain instead of guessing
  const split = plain(F.intakeBetweenDeliveries([{ date: '2026-01-01', weight: '12500 kg' }, { date: '2026-01-01', weight: '12.5t' }, { date: '2026-02-20', weight: '?' }, { date: '2026-03-01', weight: '1 kg' }], hens));
  assert.deepEqual(split.map((x) => x.gPerHenDay), [112]);
  assert.deepEqual(plain(F.intakeBetweenDeliveries(rows, 0)), []);
});

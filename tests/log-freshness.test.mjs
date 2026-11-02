import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const js = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => { throw Error('no imports'); }, Date, Math, Number, JSON, console, Intl });
  return mod.exports;
}

const { logStaleNotice, usesDailyLog } = load('src/lib/logFreshness.ts');

test('stale daily-log copy gets a plain dated notice', () => {
  assert.equal(logStaleNotice('2026-10-11', '2026-11-02'), 'Daily-log figures here last updated 11 Oct (22 days ago). Home shows the latest log.');
});

test('fresh or unknown → no notice', () => {
  assert.equal(logStaleNotice('2026-10-31', '2026-11-02'), null);
  assert.equal(logStaleNotice(null, '2026-11-02'), null);
  assert.equal(logStaleNotice('bad', '2026-11-02'), null);
});

test('only daily-log metrics trigger the check', () => {
  assert.equal(usesDailyLog(['temperature', 'hdep']), true);
  assert.equal(usesDailyLog(['temperature', 'water_litres']), false);
});

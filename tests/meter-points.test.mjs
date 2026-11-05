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

const { sumMeterPoints } = load('src/lib/meterPoints.ts');

test('two meters are summed per 30-min bucket, with a running total', () => {
  const a = [{ time: '2026-11-02T08:00:00.000Z', value: 20, cumulative: 20 }, { time: '2026-11-02T08:30:00.000Z', value: 10, cumulative: 30 }];
  const b = [{ time: '2026-11-02T08:30:00.000Z', value: 30, cumulative: 30 }];
  const s = sumMeterPoints([a, b]);
  assert.equal(JSON.stringify(s.map((p) => [p.value, p.cumulative])), '[[20,20],[40,60]]');
});

test('one meter passes through unchanged', () => {
  const a = [{ time: 't', value: 5, cumulative: 5 }];
  assert.equal(sumMeterPoints([a]), a);
  assert.equal(sumMeterPoints([]).length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/chartWindow.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports });
const { chartWindow } = module.exports;

test('zoom excludes the annual spike from scale input and reset restores it', () => {
  const rows = [{ t: 1, breakages: 160 }, { t: 2, breakages: 0.9 }, { t: 3, breakages: 1.2 }, { t: 4, breakages: 0.8 }];
  const max = data => Math.max(...data.map(row => row.breakages));
  assert.equal(max(chartWindow(rows, 1, 4)), 160);
  assert.equal(max(chartWindow(rows, 2, 4)), 1.2);
  assert.equal(max(chartWindow(rows, 3, 4)), 1.2);
  assert.equal(max(chartWindow(rows, 1, 4)), 160);
  assert.equal(rows.length, 4);
});

test('window retains boundary rows and all displayed series, standards and min-max bands', () => {
  const rows = [{ t: 1, left: 1000, right: 2000 }, { t: 2, left: 1, right: 20, standard: 15, band: [0, 25] }, { t: 3, left: null, right: 30, band: [10, 40] }];
  assert.deepEqual(chartWindow(rows, 2, 3), rows.slice(1));
  assert.equal(chartWindow(rows, 2, 2)[0], rows[1]);
  assert.deepEqual(chartWindow(rows, 4, 5), []);
});

test('acoustic windows exclude offscreen noise peaks while retaining negative values and gaps', () => {
  const rows = [{ t: 1, mean: -2 }, { t: 2, mean: -45, baseline: -50, band: [-45, -40] }, { t: 3, mean: null }, { t: 4, mean: -42 }];
  assert.deepEqual(chartWindow(rows, 2, 4), rows.slice(1));
});

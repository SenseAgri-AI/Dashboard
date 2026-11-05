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

const { flockCounts } = load('src/lib/flock.ts');

test('live hens = housed minus logged deaths; mortality % of housed', () => {
  const c = flockCounts(1000, 25);
  assert.equal(c.liveHens, 975);
  assert.equal(c.mortalityPct, 2.5);
  assert.equal(flockCounts(1000, 0).liveHens, 1000);
  assert.equal(flockCounts(10, 50).liveHens, 1); // never 0 or negative (it is a divisor for lay rate)
});

test('missing housed count → null (UI shows "—", not 0)', () => {
  assert.equal(flockCounts(0, 5).liveHens, null);
  assert.equal(flockCounts(NaN, 5).mortalityPct, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks = {}) {
  const js = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (n) => mocks[n], Date, Math, Number, JSON, console, Intl });
  return mod.exports;
}
const thi = load('src/lib/thi.ts');
const S = load('src/lib/sleepScore.ts', { './thi': thi });

const START = Date.parse('2026-10-19T20:00:00+02:00');
const quiet = Array.from({ length: 9 * 60 }, (_, i) => ({ t: START + i * 60_000, mean: -50 }));
const climate = (temp) => Array.from({ length: 9 * 6 }, (_, i) => ({ t: START + i * 600_000, temp: temp(i / 6), rh: 70, light: 0 }));

test('cold night: quiet flock still scores 100, but the cold is flagged next to it (not scored)', () => {
  const [n] = S.nightScores(quiet, climate((h) => 12 - h)); // 12 °C at 20:00 falling to ~3 °C by 05:00
  assert.equal(n.date, '2026-10-19');
  assert.equal(n.score, 100);
  assert.equal(n.coldMinC, 3.2);
  const [warm] = S.nightScores(quiet, climate(() => 16));
  assert.equal(warm.coldMinC, null);
  const [blip] = S.nightScores(quiet, climate((h) => (h < 0.3 ? 9 : 16))); // two cold readings only
  assert.equal(blip.coldMinC, null);
});

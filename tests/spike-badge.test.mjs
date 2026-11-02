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

const { spikeBadge } = load('src/lib/spikeBadge.ts');
const at = (hhmm) => Date.parse(`2026-11-02T${hhmm}:00+02:00`);

test('by day one spike is routine; two in an hour is amber', () => {
  assert.equal(spikeBadge([at('10:20')], at('10:40')), null);
  assert.equal(spikeBadge([at('10:00'), at('10:30')], at('10:40')), 'Loud spikes: listen to the clips');
  assert.equal(spikeBadge([at('09:30'), at('10:30')], at('10:40')), null); // first one is over an hour old
});

test('at night (20:00–05:00 farm-local) one spike is enough', () => {
  assert.equal(spikeBadge([at('00:39')], at('00:50')), 'Loud sound at night: listen to the clip');
  assert.equal(spikeBadge([at('04:50')], at('05:10')), 'Loud sound at night: listen to the clip'); // spike time counts, not now
  assert.equal(spikeBadge([at('05:00')], at('05:10')), null);
  assert.equal(spikeBadge([at('20:00')], at('20:05')), 'Loud sound at night: listen to the clip');
  assert.equal(spikeBadge([], at('01:00')), null);
});

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
const W = load('src/lib/thisWeek.ts');
const plain = (v) => JSON.parse(JSON.stringify(v));

// Mon 2 Nov 2026 13:45 SAST → last week = 26 Oct – 1 Nov, the week before = 19 – 25 Oct.
const NOW = Date.parse('2026-11-02T11:45:00Z');
const days = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + 'T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10));
const LAST = days('2026-10-26', 7), PREV = days('2026-10-19', 7);
const log = (d, eggs, deaths = 0, hdep = 88) => ({ date: d, eggs, hdep, mortality: deaths });
const line = (r, k) => r.lines.find((l) => l.key === k);
const build = (x) => W.buildThisWeek({ now: NOW, offsetHours: 2, water: [], inside: [], ...x });

test('windows are farm-local complete days; just after local midnight the new day is not included', () => {
  assert.deepEqual(plain(W.weekWindows(NOW, 2)), { last: LAST, prev: PREV });
  // 00:30 SAST on 2 Nov is still 1 Nov in UTC: the window must follow SAST
  assert.deepEqual(plain(W.weekWindows(Date.parse('2026-11-01T22:30:00Z'), 2).last), LAST);
  assert.equal(build({}).range, '26 Oct – 1 Nov');
});

test('eggs: average per day with lay %, plain change; a 5%+ drop is an early warning', () => {
  const steady = build({ daily: [...PREV.map((d) => log(d, 4000)), ...LAST.map((d) => log(d, 4040))] });
  const e = line(steady, 'eggs');
  assert.equal(e.value.replace(/\s/g, ' '), '4 040/day (lay 88%)');
  assert.equal(e.change, 'about the same as last week');
  assert.equal(e.rag, 'neutral');
  const drop = line(build({ daily: [...PREV.map((d) => log(d, 4000)), ...LAST.map((d) => log(d, 3680))] }), 'eggs');
  assert.equal(drop.change, '↓ 8% on last week');
  assert.equal(drop.rag, 'amber');
  assert.match(drop.note, /^Early warning/);
});

test('eggs and deaths: too few logged days says so, never a fake comparison', () => {
  const r = build({ daily: LAST.slice(0, 3).map((d) => log(d, 4000)) });
  assert.equal(line(r, 'eggs').value, '3 of 7 days logged');
  assert.equal(line(r, 'eggs').rag, 'unknown');
  assert.equal(line(r, 'deaths').change, 'not enough to compare');
  assert.equal(line(build({ daily: undefined }), 'eggs').value, "couldn't load");
});

test('deaths: totals; early warning only when high and at least double', () => {
  const r = (a, b) => line(build({ daily: [...PREV.map((d, i) => log(d, 4000, i < b ? 1 : 0)), ...LAST.map((d, i) => log(d, 4000, i < a ? 2 : 0))] }), 'deaths');
  assert.equal(r(1, 2).value, '2');
  assert.equal(r(1, 2).change, 'last week 2');
  assert.equal(r(1, 2).rag, 'neutral');
  assert.equal(r(4, 3).rag, 'amber'); // 8 vs 3
  assert.equal(r(3, 4).rag, 'neutral'); // 6: below the minimum
});

test('water: average of complete days; gaps are not zero; a 30%+ drop is an early warning', () => {
  const wd = (d, a, b) => ({ date: d, meters: [a, b] });
  const ok = line(build({ water: [...PREV.map((d) => wd(d, 500, 500)), ...LAST.map((d) => wd(d, 520, 500))] }), 'water');
  assert.equal(ok.value.replace(/\s/g, ' '), '1 020 L/day');
  assert.equal(ok.change, 'about the same as last week');
  const gap = line(build({ water: [...PREV.map((d) => wd(d, 500, 500)), ...LAST.map((d, i) => wd(d, i < 2 ? null : 500, 500))] }), 'water');
  assert.equal(gap.value.replace(/\s/g, ' '), '1 000 L/day'); // the 2 gap days are left out, not zero
  assert.equal(gap.note, '5 of 7 days measured');
  const drop = line(build({ water: [...PREV.map((d) => wd(d, 500, 500)), ...LAST.map((d) => wd(d, 300, 300))] }), 'water');
  assert.equal(drop.change, '↓ 40% on last week');
  assert.equal(drop.rag, 'amber');
  assert.equal(line(build({ water: 'loading' }), 'water'), undefined);
  assert.equal(line(build({ water: undefined }), 'water').value, "couldn't load");
  // one-meter farm: the empty meter is ignored
  assert.equal(line(build({ water: [...PREV, ...LAST].map((d) => wd(d, 400, null)) }), 'water').value, '400 L/day');
});

test('hottest inside day, with the count of 32 °C+ days', () => {
  const ins = [...PREV.map((d) => ({ date: d, maxC: 30 })), ...LAST.map((d, i) => ({ date: d, maxC: i === 5 ? 34.3 : i > 2 ? 32.1 : 30 }))];
  const h = line(build({ inside: ins }), 'heat');
  assert.equal(h.value, '34°C on Sat 31 Oct');
  assert.equal(h.change, 'last week 30°C');
  assert.equal(h.note, '4 days at 32°C+ (last week 0)');
  assert.equal(h.rag, 'neutral');
});

test('coldest inside: only shown when a night reached 10 °C or below in either week', () => {
  const warm = [...PREV, ...LAST].map((d) => ({ date: d, maxC: 30, minC: 15 }));
  assert.equal(line(build({ inside: warm }), 'cold'), undefined); // warm fortnight: no clutter
  const ins = [...PREV.map((d, i) => ({ date: d, maxC: 25, minC: i < 3 ? 7.6 : 12 })), ...LAST.map((d, i) => ({ date: d, maxC: 25, minC: i === 1 ? 9.4 : 13 }))];
  const c = line(build({ inside: ins }), 'cold');
  assert.equal(c.label, 'Coldest inside');
  assert.equal(c.value, '9°C on Tue 27 Oct');
  assert.equal(c.change, 'last week 8°C');
  assert.equal(c.note, '1 night at 10°C or below (last week 3)');
  // old rows without minC (or a failed load) never break the card
  assert.equal(line(build({ inside: [...PREV, ...LAST].map((d) => ({ date: d, maxC: 30 })) }), 'cold'), undefined);
  assert.equal(line(build({ inside: undefined }), 'cold'), undefined);
});

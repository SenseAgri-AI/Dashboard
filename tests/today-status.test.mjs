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
const thi = load('src/lib/thi.ts');
const legacy = load('src/lib/legacyAlerts.ts', { './thi': thi });
const T = load('src/lib/todayStatus.ts', { './thi': thi, './legacyAlerts': legacy });

const NOW = Date.parse('2026-10-31T10:00:00Z'); // 12:00 SAST
const min = (m) => NOW - m * 60_000;
const iso = (m) => new Date(min(m)).toISOString();
const plain = (v) => JSON.parse(JSON.stringify(v));
const day = (date, hdep, mortality) => ({ date, eggs: 4000, hdep, mortality });
const week = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'].map((d) => day(d, 92, 1));
const co2 = (...vals) => vals.map((v, i) => ({ time: iso(30 * (vals.length - 1 - i)), value: v })); // last value = now
const base = (extra = {}) => ({ now: NOW, daily: [...week, day('2026-10-30', 92, 1)], lastLogDate: '2026-10-30',
  climate: { temperatureC: 24, humidityPct: 60, co2Series: co2(600, 650, 700) },
  climateLastMs: min(3), siloLastMs: min(120),
  waterMeters: [{ name: 'A-frame 1', lastMs: min(20) }, { name: 'A-frame 2', lastMs: min(20) }],
  silos: [{ name: 'Silo 1', low: false }], alerts: [], extras: [], ...extra });
const today = (extra) => T.buildToday(base(extra));
const line = (r, key) => r.lines.find((l) => l.key === key);
const keys = (r) => plain(r.lines.map((l) => l.key));

test('defaults reuse the existing alert windows', () => {
  const d = T.DEFAULT_TODAY_THRESHOLDS;
  assert.equal(d.staleMinutes.climate.amber, legacy.FEED_STALE_MIN);
  assert.equal(d.logStaleDays.red, legacy.LOG_OVERDUE_DAYS);
  assert.equal(d.feltTempC.amber, thi.THI_SEVERE);
  assert.equal(d.feltTempC.red, thi.THI_EXTREME);
  assert.equal(d.co2Sustained.ppm, 1400);
});

test('farm overrides merge deeply and ignore junk values', () => {
  const t = T.mergeThresholds({ staleMinutes: { climate: { amber: 30 } }, co2Sustained: { ppm: 'x' }, hdepDropPts: { amber: -1 }, extra: 5 });
  assert.equal(t.staleMinutes.climate.amber, 30);
  assert.equal(t.staleMinutes.climate.red, 60);
  assert.equal(t.co2Sustained.ppm, 1400);
  assert.equal(t.hdepDropPts.amber, 3);
  assert.equal('extra' in t, false);
  assert.deepEqual(plain(T.mergeThresholds(undefined)), plain(T.DEFAULT_TODAY_THRESHOLDS));
});

test('quiet farm: "All good" with only Birds and Climate', () => {
  const r = today();
  assert.equal(r.headline, 'All good');
  assert.equal(r.problems, 0);
  assert.equal(r.someChecksFailed, false);
  assert.deepEqual(keys(r), ['birds', 'climate']);
  assert.equal(line(r, 'birds').text, 'Lay 92% · 1 death');
  assert.equal(line(r, 'climate').text, 'Feels 22.8°C');
});

test('headline counts problems', () => {
  const r = today({ silos: [{ name: 'Silo 2', low: true }], daily: [...week, day('2026-10-30', 85, 1)] });
  assert.equal(r.problems, 2);
  assert.equal(r.headline, '2 things need you today');
  assert.equal(today({ silos: [{ name: 'Silo 2', low: true }] }).headline, '1 thing needs you today');
});

test('a failed check gives one footer flag, never a grey line or "All good"', () => {
  const r = today({ silos: undefined, alerts: undefined, daily: undefined });
  assert.equal(r.someChecksFailed, true);
  assert.equal(r.headline, 'Nothing flagged');
  assert.deepEqual(keys(r), ['climate']); // Birds hidden when the log failed to load
  assert.ok(r.lines.every((l) => l.rag !== 'unknown'));
  assert.equal(today({ waterMeters: [{ name: 'A-frame 1', lastMs: undefined }] }).someChecksFailed, true);
  assert.equal(today({ climateLastMs: undefined }).someChecksFailed, true);
});

test('birds: hen-day drop vs recent median', () => {
  assert.equal(line(today({ daily: [...week, day('2026-10-30', 88, 1)] }), 'birds').rag, 'amber');
  const red = line(today({ daily: [...week, day('2026-10-30', 85, 1)] }), 'birds');
  assert.equal(red.rag, 'red');
  assert.match(red.text, /down 7 pts/);
  assert.equal(line(today({ daily: [day('2026-10-29', 92, 1), day('2026-10-30', 80, 1)] }), 'birds').rag, 'green'); // too little history
});

test('birds: deaths vs usual, with a minimum count', () => {
  assert.equal(line(today({ daily: [...week, day('2026-10-30', 92, 2)] }), 'birds').rag, 'green');
  assert.equal(line(today({ daily: [...week, day('2026-10-30', 92, 3)] }), 'birds').rag, 'red');
  const zeroWeek = week.map((d) => ({ ...d, mortality: 0 }));
  assert.equal(line(today({ daily: [...zeroWeek, day('2026-10-30', 92, 1)] }), 'birds').rag, 'green');
  const twoWeek = week.map((d) => ({ ...d, mortality: 2 }));
  const amber = line(today({ daily: [...twoWeek, day('2026-10-30', 92, 4)] }), 'birds');
  assert.equal(amber.rag, 'amber');
  assert.match(amber.text, /usual 2/);
});

test('birds: missing-log nudge lives in the Birds line', () => {
  const nudge = line(today({ lastLogDate: '2026-10-27' }), 'birds');
  assert.equal(nudge.rag, 'amber');
  assert.match(nudge.text, /log missing 4 days/);
  assert.equal(nudge.action, 'Fill in the daily log');
  assert.equal(line(today({ lastLogDate: '2026-10-24' }), 'birds').rag, 'red');
  const empty = line(today({ daily: [], lastLogDate: null }), 'birds');
  assert.equal(empty.text, 'No daily log yet');
  // the Home attention "daily-log" item and the notifier's log alert are not repeated
  const r = today({ lastLogDate: '2026-10-27', extras: [{ id: 'daily-log', severity: 'warning', title: 'Daily log not up to date', detail: '' }],
    alerts: [{ id: 'egg_log_overdue#1', category: 'reminder', severity: 'warning', title: 'Fill in the daily log' }] });
  assert.deepEqual(keys(r), ['birds', 'climate']);
  assert.equal(r.problems, 1);
});

test('daily-log freshness uses farm-local days', () => {
  assert.equal(T.logFreshness('2026-10-31', NOW).text, 'logged today');
  assert.equal(T.logFreshness('2026-10-28', NOW).rag, 'amber');
  assert.equal(T.logFreshness('2026-10-25', NOW).rag, 'red');
  assert.equal(T.logFreshness(undefined, NOW).rag, 'unknown');
  assert.equal(T.daysSinceLog('2026-10-31', Date.parse('2026-10-30T23:30:00Z')), 0);
});

test('climate: felt temperature bands', () => {
  const c = (temperatureC, humidityPct) => line(today({ climate: { temperatureC, humidityPct, co2Series: [] } }), 'climate');
  assert.equal(c(31, 70).rag, 'amber'); // feels ~29.5
  assert.equal(c(32, 70).rag, 'red');
  assert.equal(c(6553.5, 60), undefined); // EM300 junk: no line, never a fake value
});

test('climate: CO2 only when sustained at or above 1400 ppm', () => {
  const t = T.DEFAULT_TODAY_THRESHOLDS;
  assert.equal(T.co2Sustained(co2(1500, 1450, 1420), NOW, t), 1420);
  assert.equal(T.co2Sustained(co2(1500, 1300, 1500), NOW, t), null); // dipped below
  assert.equal(T.co2Sustained(co2(1500), NOW, t), null);             // not enough coverage
  assert.equal(T.co2Sustained(co2(1000, 1000, 1000), NOW, t), null);
  const shown = line(today({ climate: { temperatureC: 22, humidityPct: 60, co2Series: co2(1500, 1450, 1420) } }), 'climate');
  assert.equal(shown.rag, 'red');
  assert.match(shown.text, /CO₂ 1[,\s ]?420 ppm for 60\+ min/);
  assert.equal(shown.action, 'Check fans and inlets now');
  const brief = line(today({ climate: { temperatureC: 22, humidityPct: 60, co2Series: co2(700, 700, 1600) } }), 'climate');
  assert.equal(brief.rag, 'green');
  assert.doesNotMatch(brief.text, /CO₂/);
});

test('water, silo and sensors appear only on a problem', () => {
  const water = today({ alerts: [{ id: 'water_zero_3h#1', category: 'water', severity: 'danger', title: 'Possible water problem — A-frame 1' }] });
  assert.equal(line(water, 'water').rag, 'red');
  assert.equal(line(water, 'water').text, 'Possible water problem — A-frame 1');
  const silo = line(today({ silos: [{ name: 'Silo 1', low: false }, { name: 'Silo 2', low: true }] }), 'silo');
  assert.equal(silo.text, 'Silo 2 running low');
  assert.doesNotMatch(silo.text, /%|day/);
  const stale = line(today({ waterMeters: [{ name: 'A-frame 1', lastMs: min(10) }, { name: 'A-frame 2', lastMs: min(400) }] }), 'data');
  assert.equal(stale.rag, 'red');
  assert.equal(stale.text, 'Water (A-frame 2): no data for 7 h');
  assert.equal(line(today({ climateLastMs: min(16) }), 'data').rag, 'amber');
  assert.equal(line(today({ siloLastMs: min(36 * 60) }), 'data'), undefined); // sparse radar: long window
  assert.equal(line(today({ siloLastMs: null }), 'data').text, 'Silo: no data this week');
  assert.equal(line(today({ alertsStale: true }), 'data').text, 'Farm alerts are delayed');
  const power = today({ alerts: [{ id: 'power_outage#1', category: 'power', severity: 'danger', title: 'Power / network down' }] });
  assert.equal(line(power, 'data').rag, 'red');
});

test('alerts raise a line but never lower it; info alerts and info extras stay quiet', () => {
  const r = today({ alerts: [{ id: 'heat_stress#1', category: 'climate', severity: 'info', title: 'fyi' }],
    extras: [{ id: 'schedules', severity: 'info', title: 'Check schedules', detail: '' }] });
  assert.equal(r.headline, 'All good');
  const hot = line(today({ climate: { temperatureC: 32, humidityPct: 70, co2Series: [] },
    alerts: [{ id: 'heat_stress#1', category: 'climate', severity: 'warning', title: 'Heat stress' }] }), 'climate');
  assert.equal(hot.rag, 'red');
  const extra = today({ extras: [{ id: 'new_rule', severity: 'warning', title: 'Something', detail: 'Do this' }] });
  assert.equal(line(extra, 'extra:new_rule').action, 'Do this');
});

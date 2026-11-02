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
  climateLastMs: min(3), siloRadars: [{ name: 'Silo 1', lastMs: min(120) }, { name: 'Silo 2', lastMs: min(200) }],
  waterMeters: [{ name: 'A-frame 1', lastMs: min(20) }, { name: 'A-frame 2', lastMs: min(20) }], waterDays: [],
  silos: [{ name: 'Silo 1', low: false }], alerts: [], extras: [], ...extra });
const today = (extra) => T.buildToday(base(extra));
const line = (r, key) => r.lines.find((l) => l.key === key);
const keys = (r) => plain(r.lines.map((l) => l.key));

test('defaults reuse the existing alert windows', () => {
  const d = T.DEFAULT_TODAY_THRESHOLDS;
  assert.equal(d.staleMinutes.climate.amber, 30);
  assert.equal(d.staleMinutes.climate.red, 90);
  assert.equal(d.dryBulbC.amber, 32);
  assert.deepEqual(plain(d.birdsAlertTypes), ['sleep_decline']);
  assert.equal(d.logStaleDays.red, legacy.LOG_OVERDUE_DAYS);
  assert.equal(d.feltTempC.amber, thi.THI_SEVERE);
  assert.equal(d.feltTempC.red, thi.THI_EXTREME);
  assert.equal(d.co2Sustained.ppm, 1400);
});

test('farm overrides merge deeply and ignore junk values', () => {
  const t = T.mergeThresholds({ staleMinutes: { climate: { amber: 45 } }, co2Sustained: { ppm: 'x' }, hdepDrop: { pts: -1 }, dryBulbC: { amber: 31 },
    birdsAlertTypes: ['sleep_decline', 'night_disturbance'], extra: 5 });
  assert.equal(t.staleMinutes.climate.amber, 45);
  assert.equal(t.staleMinutes.climate.red, 90);
  assert.equal(t.co2Sustained.ppm, 1400);
  assert.equal(t.hdepDrop.pts, 5);
  assert.equal(t.dryBulbC.amber, 31);
  assert.deepEqual(plain(t.birdsAlertTypes), ['sleep_decline', 'night_disturbance']);
  assert.deepEqual(plain(T.mergeThresholds({ birdsAlertTypes: [1] }).birdsAlertTypes), ['sleep_decline']);
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
  assert.equal(line(r, 'climate').text, '24°C (feels 22.8°C)');
});

test('headline counts problems', () => {
  const r = today({ silos: [{ name: 'Silo 2', low: true }], daily: [...week, day('2026-10-29', 85, 1), day('2026-10-30', 85, 1)] });
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
  assert.equal(today({ siloRadars: undefined }).someChecksFailed, true);
  assert.equal(today({ siloRadars: [{ name: 'Silo 1', lastMs: undefined }] }).someChecksFailed, true);
});

const wk = (hdep, mortality = 1) => ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map((d) => day(d, hdep, mortality));
const tail = (...v) => v.map((h, i) => day(`2026-10-${23 + i}`, h, 1));
// lastLogDate fixed to yesterday so the missing-log nudge stays out of these rule tests
const birds = (rows) => line(today({ daily: rows, lastLogDate: '2026-10-30' }), 'birds');

test('birds: lay drop needs consecutive days', () => {
  assert.equal(birds([...wk(92), ...tail(92, 92, 92, 92, 92, 92, 85)]).rag, 'green'); // one-day dip = collection timing
  const amber = birds([...wk(92), ...tail(92, 92, 92, 92, 92, 86, 86)]);
  assert.equal(amber.rag, 'amber');
  assert.match(amber.text, /down 6 pts for 2 days/);
  assert.equal(birds([...wk(92), ...tail(92, 92, 92, 92, 86, 86, 86)]).rag, 'red');
  assert.equal(birds([...wk(92), ...tail(92, 92, 92, 92, 92, 88, 88)]).rag, 'green'); // 4 pts: within day-to-day noise
  assert.equal(birds([day('2026-10-28', 92, 1), day('2026-10-29', 80, 1), day('2026-10-30', 80, 1)]).rag, 'green'); // too little history
});

test('birds: implausible hen-day % is a log problem and stays out of baselines', () => {
  const low = birds([...wk(92), ...tail(92, 92, 92, 92, 92, 92, 3)]);
  assert.equal(low.rag, 'amber');
  assert.match(low.text, /Lay 3% looks wrong/);
  assert.equal(low.action, 'Check the last egg count in the log');
  assert.match(birds([...wk(92), ...tail(92, 92, 92, 92, 92, 92, 105)]).text, /looks wrong/);
  assert.equal(birds([...wk(92), ...tail(92, 92, 92, 2, 92, 92, 92)]).rag, 'green'); // bad entry not in the baseline
});

test('birds: one bad day of deaths is amber, a bad week is red', () => {
  assert.equal(birds([...week, day('2026-10-30', 92, 2)]).rag, 'green'); // below minDeaths
  const one = birds([...week, day('2026-10-30', 92, 3)]);
  assert.equal(one.rag, 'amber');
  assert.match(one.text, /3 deaths \(usual 1\)/);
  const zeroWeek = week.map((d) => ({ ...d, mortality: 0 }));
  assert.equal(birds([...zeroWeek, day('2026-10-30', 92, 1)]).rag, 'green');
  // 4 quiet weeks (~0.3/day), then a week totalling 9 → red
  const quiet = Array.from({ length: 28 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, '0')}`, 92, i % 3 === 0 ? 1 : 0));
  const bad = [1, 2, 1, 1, 2, 1, 1].map((m, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`, 92, m));
  const red = birds([...quiet, ...bad]);
  assert.equal(red.rag, 'red');
  assert.match(red.text, /9 this week/);
  assert.equal(red.action, 'Check the birds today; consider calling the vet');
  // the same week is not red when it is the farm's usual rate
  const usual = Array.from({ length: 28 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, '0')}`, 92, i % 7 < 2 ? 2 : 1));
  assert.notEqual(birds([...usual, ...bad]).rag, 'red');
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

test('only the poor-sleep alert raises Birds; night disturbance does not', () => {
  const night = today({ alerts: [{ id: 'night_disturbance#2026-10-30T23:00', category: 'welfare', severity: 'warning', title: 'Birds unsettled overnight' }] });
  assert.equal(line(night, 'birds').rag, 'green');
  assert.equal(night.headline, 'All good');
  const sleep = line(today({ alerts: [{ id: 'sleep_decline#2026-10-15T05:00', category: 'welfare', severity: 'warning', title: 'Poor flock sleep' }] }), 'birds');
  assert.equal(sleep.rag, 'amber');
  assert.equal(sleep.text, 'Poor flock sleep');
});

test('daily-log freshness uses farm-local days', () => {
  assert.equal(T.logFreshness('2026-10-31', NOW).text, 'logged today');
  assert.equal(T.logFreshness('2026-10-28', NOW).rag, 'amber');
  assert.equal(T.logFreshness('2026-10-25', NOW).rag, 'red');
  assert.equal(T.logFreshness(undefined, NOW).rag, 'unknown');
  assert.equal(T.daysSinceLog('2026-10-31', Date.parse('2026-10-30T23:30:00Z')), 0);
});

test('climate: felt temperature bands, actual °C always shown', () => {
  const c = (temperatureC, humidityPct) => line(today({ climate: { temperatureC, humidityPct, co2Series: [] } }), 'climate');
  assert.equal(c(31, 70).rag, 'amber'); // feels ~29.5
  assert.equal(c(31, 70).text, '31°C (feels 29.5°C)');
  assert.equal(c(32, 70).rag, 'red');
  assert.equal(c(6553.5, 60), undefined); // EM300 junk: no line, never a fake value
});

test('climate: dry-bulb backstop only when sustained', () => {
  const c = (tempSeries, temperatureC, humidityPct) => line(today({ climate: { temperatureC, humidityPct, co2Series: [], tempSeries } }), 'climate');
  const dry = c(co2(33, 33), 33, 15); // feels ~26.8: green by the index alone
  assert.equal(dry.rag, 'amber');
  assert.match(dry.text, /^33°C \(feels 2\d\.\d°C\), 32°C\+ for 30\+ min$/);
  assert.equal(dry.action, 'Increase airflow, keep water cool');
  assert.equal(c(co2(33, 31), 31, 15).rag, 'green');  // dipped below inside the window
  assert.equal(c([], 33, 15).rag, 'green');           // no series → never fires on a single reading
  assert.equal(c(co2(36, 36), 34, 70).rag, 'red');    // felt index stays primary (feels > 30)
  const t = T.mergeThresholds({ dryBulbC: { amber: 30, dwellMinutes: 60 } });
  assert.equal(T.sustainedAtOrAbove(co2(31), NOW, t.dryBulbC.amber, t.dryBulbC.dwellMinutes), null); // 1 bucket < 60 min
  assert.equal(T.sustainedAtOrAbove(co2(31, 31, 31), NOW, t.dryBulbC.amber, t.dryBulbC.dwellMinutes), 31);
});

test('climate: warming fast early warning (rise over 60 min, above the floor, below amber)', () => {
  const c = (tempSeries, temperatureC = 29, humidityPct = 30) => line(today({ climate: { temperatureC, humidityPct, co2Series: [], tempSeries } }), 'climate');
  const w = c(co2(25.5, 27, 29)); // +3.5 °C in 60 min, now 29 °C, feels < 28.9
  assert.equal(w.rag, 'amber');
  assert.match(w.text, /^29°C \(feels 2\d\.\d°C\) · Warming fast: up 3\.5°C in the last hour$/);
  assert.equal(w.action, 'Early warning: check fans and ventilation');
  assert.equal(c(co2(25, 27, 28)).rag, 'amber');              // edges: rise exactly 3, latest exactly 28
  assert.equal(T.warmingFast(co2(29.3, 31, 32.3), NOW, T.DEFAULT_TODAY_THRESHOLDS), 32.3 - 29.3); // 2.9999… in floats, still a 3.0 rise
  assert.equal(c(co2(25.1, 27, 28)).rag, 'green');            // rise 2.9
  assert.equal(c(co2(24, 26, 27.9), 27.9).rag, 'green');      // below the warm floor
  assert.equal(c(co2(29, 26, 29)).rag, 'green');              // only the 60-min change counts, not a dip-and-recover
  assert.equal(c(co2(26, 29)).rag, 'green');                  // no bucket 60 min earlier
  assert.equal(c([]).rag, 'green');                           // no series
  const old = [{ time: iso(150), value: 25 }, { time: iso(90), value: 29 }];
  assert.equal(T.warmingFast(old, NOW, T.DEFAULT_TODAY_THRESHOLDS), null); // latest point too old
  const felt = c(co2(27, 29, 31), 31, 70);                    // already amber by felt temp: no extra warning
  assert.equal(felt.rag, 'amber');
  assert.equal(felt.action, 'Increase airflow, keep water cool');
  assert.equal(felt.text.includes('Warming fast'), false);
  const dry = c(co2(32, 33, 35), 35, 0);                     // dry-bulb backstop already amber: its text, no extra warning
  assert.match(dry.text, /32°C\+ for 30\+ min$/);
  assert.equal(c(co2(29, 31, 33), 34, 70).rag, 'red');        // felt red wins
  assert.equal(c(co2(29, 31, 33), 34, 70).text.includes('Warming fast'), false);
  assert.equal(c(co2(25, 61, 27, 29)).rag, 'green');      // junk reading (61 °C, above the 60 filter) 60 min ago ignored → no pair, never a fake rise
  const t = T.mergeThresholds({ warmingFast: { riseC: 2, windowMinutes: 30, floorC: 26 } });
  assert.equal(T.warmingFast(co2(24, 26.5), NOW, t), 2.5);
  assert.equal(T.DEFAULT_TODAY_THRESHOLDS.warmingFast.riseC, 3);
});

test('climate: dry-bulb backstop never fires on a lone reading after a gap', () => {
  const lone = [{ time: iso(5), value: 33 }];
  assert.equal(T.sustainedAtOrAbove(lone, NOW, 32, 30), null);
  assert.equal(line(today({ climate: { temperatureC: 33, humidityPct: 15, co2Series: [], tempSeries: lone } }), 'climate').rag, 'green');
});

test('climate: "feels" is never shown warmer than the air in the cold', () => {
  assert.equal(line(today({ climate: { temperatureC: 8, humidityPct: 50, co2Series: [] } }), 'climate').text, '8°C (feels 8°C)');
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
  assert.equal(line(today({ climateLastMs: min(20) }), 'data'), undefined); // one missed 10-min uplink
  assert.equal(line(today({ climateLastMs: min(31) }), 'data').rag, 'amber');
  assert.equal(line(today({ climateLastMs: min(91) }), 'data').rag, 'red');
  assert.equal(line(today({ siloRadars: [{ name: 'Silo 1', lastMs: min(36 * 60) }] }), 'data'), undefined); // sparse radar: long window
  // per radar: a fresh radar does not hide a silent one
  const silent = line(today({ siloRadars: [{ name: 'Silo 1', lastMs: min(60) }, { name: 'Silo 2', lastMs: min(54 * 60) }] }), 'data');
  assert.equal(silent.rag, 'amber');
  assert.equal(silent.text, 'Silo 2: no data for 2 days');
  assert.equal(line(today({ siloRadars: [{ name: 'Silo 1', lastMs: null }] }), 'data').text, 'Silo 1: no data this week');
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

// ── Water use vs the flock's own normal ──────────────────────────────────────
// NOW = 31 Oct 12:00 SAST, so the latest complete UTC day is 30 Oct.
const wdays = (vals) => vals.map((m, i) => ({ date: new Date(Date.parse('2026-10-30T00:00:00Z') - (vals.length - 1 - i) * 86_400_000).toISOString().slice(0, 10), meters: m }));
const normal = Array.from({ length: 14 }, () => [500, 500]);
const water = (tail, extra = {}) => line(today({ waterDays: wdays([...normal, ...tail]), waterMeterNames: ['Meter 1', 'Meter 2'], ...extra }), 'water');

test('water: normal use shows no line', () => {
  assert.equal(water([[480, 520], [450, 500]]), undefined);
});

test('water: one low day is not enough for the farm rule', () => {
  assert.equal(water([[500, 500], [300, 300]]), undefined);
});

test('water: two low days -> amber early warning with litres and baseline', () => {
  const l = water([[300, 300], [320, 280]]);
  assert.equal(l.rag, 'amber');
  assert.match(l.text, /Down 40% on usual for 2 days: 600 L\/day vs ~1[\s ]?000 L/);
  assert.match(l.action, /^Early warning/);
});

test('water: three low days -> red', () => {
  assert.equal(water([[300, 300], [300, 300], [300, 300]]).rag, 'red');
});

test('water: one line quiet while the other is normal -> amber naming the meter', () => {
  const l = water([[500, 500], [0, 520]]);
  assert.equal(l.rag, 'amber');
  assert.match(l.text, /^Meter 1 used 0 L on 30 Oct vs ~500 L usual/);
});

test('water: both lines low on one day is not a single-line problem', () => {
  assert.equal(water([[500, 500], [100, 100]]), undefined);
});

test('water: a gap is never read as zero, and old data never fires', () => {
  assert.equal(water([[300, 300], [null, 300]]), undefined);
  const old = wdays([...normal, [300, 300], [300, 300]]).map((d) => ({ ...d, date: d.date.replace('2026-10', '2026-09') }));
  assert.equal(line(today({ waterDays: old }), 'water'), undefined);
});

test('water: too little baseline or a tiny baseline does not fire', () => {
  assert.equal(line(today({ waterDays: wdays([[500, 500], [500, 500], [100, 100], [100, 100]]) }), 'water'), undefined);
  assert.equal(line(today({ waterDays: wdays([...Array.from({ length: 14 }, () => [100, 100]), [20, 20], [20, 20]]) }), 'water'), undefined);
});

test('water: failed load shows the footer, never a line', () => {
  const r = today({ waterDays: undefined });
  assert.equal(r.someChecksFailed, true);
  assert.equal(line(r, 'water'), undefined);
});

test('water: a platform water alert still wins over a farm drop', () => {
  const l = water([[300, 300], [300, 300]], { alerts: [{ id: 'water_x', category: 'water', severity: 'danger', title: 'A-frame 2 no flow' }] });
  assert.equal(l.rag, 'red');
  assert.equal(l.text, 'A-frame 2 no flow');
});

test('water: a missing calendar day breaks the run (no "2 days" across a gap)', () => {
  // low on 29 and 31 Oct, no rows at all for 30 Oct (now = 1 Nov)
  const days = [...wdays([...normal, [300, 300]]).map((x) => ({ ...x, date: new Date(Date.parse(x.date + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10) })),
    { date: '2026-10-31', meters: [300, 300] }];
  assert.equal(days.at(-2).date, '2026-10-29');
  const now = Date.parse('2026-11-01T10:00:00Z');
  assert.equal(T.waterUseCheck(days, now, undefined, ['Meter 1', 'Meter 2']), null);
  // with 30 Oct present and low, it does fire
  const full = [...days.slice(0, -1), { date: '2026-10-30', meters: [300, 300] }, days.at(-1)];
  assert.equal(T.waterUseCheck(full, now, undefined, ['Meter 1', 'Meter 2']).rag, 'red');
});

test('water: a one-meter farm still gets the farm check, never the line check', () => {
  const one = wdays([...Array.from({ length: 14 }, () => [500, null]), [300, null], [300, null]]);
  const l = line(today({ waterDays: one, waterMeterNames: ['Meter 1', 'Meter 2'] }), 'water');
  assert.equal(l.rag, 'amber');
  assert.match(l.text, /^Down 40% on usual for 2 days: 300 L\/day vs ~500 L/);
  const quiet = wdays([...Array.from({ length: 14 }, () => [500, null]), [500, null], [0, null]]);
  assert.equal(line(today({ waterDays: quiet }), 'water'), undefined);
});

test('Live dashboard heat tile status follows the Today card climate rules', () => {
  const now = Date.parse('2026-11-02T13:00:00Z');
  const ser = (v, n = 3) => Array.from({ length: n }, (_, i) => ({ time: new Date(now - (n - 1 - i) * 30 * 60_000).toISOString(), value: v }));
  assert.equal(T.heatTileStatus(30.2, ser(31), now), 'danger');   // felt ≥ red
  assert.equal(T.heatTileStatus(29.0, ser(31), now), 'warning');  // felt ≥ amber
  assert.equal(T.heatTileStatus(27.1, ser(32.4), now), 'warning'); // dry heat, sustained 32 °C+
  assert.equal(T.heatTileStatus(27.1, ser(31), now), null);       // dry 31 °C: not hot by the Today card either
  assert.equal(T.heatTileStatus(27.1, ser(32.4, 1), now), null);  // one reading is never sustained
});

test('climate: cold house early warning (10 °C or below for 60+ min), never one reading', () => {
  const c = (tempSeries, temperatureC = 8, humidityPct = 80) => line(today({ climate: { temperatureC, humidityPct, co2Series: [], tempSeries } }), 'climate');
  const cold = c(co2(9.5, 8.6, 8));
  assert.equal(cold.rag, 'amber');
  assert.match(cold.text, /^8°C \(feels .*\) · Cold: 10°C or below for 60\+ min$/);
  assert.equal(cold.action, 'Early warning: check curtains and draughts');
  assert.equal(c(co2(10, 10, 10), 10).rag, 'amber');   // edge: exactly 10
  assert.equal(c(co2(10.6, 9, 8)).rag, 'green');        // warmer an hour ago: not sustained
  assert.equal(c(co2(9, 8)).rag, 'green');              // too few buckets
  assert.equal(c([], 8).rag, 'green');                  // a single reading never fires
});

test('last night: a disturbed flock-sleep score shows once, in the morning check', () => {
  // NOW = 31 Oct 12:00 SAST → last night = the evening of 30 Oct
  const n = line(today({ nights: [{ date: '2026-10-29', score: 100 }, { date: '2026-10-30', score: 35.3 }] }), 'night');
  assert.equal(n.rag, 'amber');
  assert.equal(n.text, 'Disturbed: flock sleep score 35/100');
  assert.equal(n.action, 'Early warning: check for lights, predators or people in the night');
  assert.equal(line(today({ nights: [{ date: '2026-10-30', score: 64.8 }] }), 'night'), undefined); // "some disruption" isn't flagged
  assert.equal(line(today({ nights: [{ date: '2026-10-29', score: 20 }] }), 'night'), undefined);   // an older night isn't today's news
  assert.equal(line(today({}), 'night'), undefined);                                                 // no data → no line, no failure footer
  assert.equal(today({}).someChecksFailed, today({ nights: [] }).someChecksFailed);
});

test('one silent house sensor is flagged even while Climate looks fresh', () => {
  const both = [{ name: 'House sensor 1', lastMs: min(3) }, { name: 'House sensor 2', lastMs: min(5) }];
  assert.equal(line(today({ climateSensors: both }), 'data'), undefined);
  const r = today({ climateSensors: [both[0], { name: 'House sensor 2', lastMs: min(240) }] });
  const d = line(r, 'data');
  assert.equal(d.rag, 'amber');
  assert.match(d.text, /^House sensor 2: no data for 4 h; house numbers are from the other sensor only$/);
  const gone = line(today({ climateSensors: [both[0], { name: 'House sensor 2', lastMs: null }] }), 'data');
  assert.match(gone.text, /House sensor 2: no data this week/);
  // whole climate stream stale → only the Climate item, not one per sensor
  const all = line(today({ climateLastMs: min(240), climateSensors: [{ name: 'House sensor 1', lastMs: min(240) }, { name: 'House sensor 2', lastMs: min(250) }] }), 'data');
  assert.doesNotMatch(all.text, /House sensor/);
  // a single-sensor house never gets this item
  assert.equal(line(today({ climateSensors: [{ name: 'House sensor 1', lastMs: min(240) }] }), 'data'), undefined);
});

test('last night: the action points at what cost the most points', () => {
  const act = (breakdown) => line(today({ nights: [{ date: '2026-10-30', score: 40, breakdown }] }), 'night').action;
  assert.equal(act({ noise: 30, bouts: 20, severity: 5, predawn: 5, heat: 0, darkness: 0 }), 'Early warning: noisy night; check for predators or people');
  assert.equal(act({ noise: 5, bouts: 0, severity: 0, predawn: 0, heat: 0, darkness: 50 }), 'Early warning: short dark period; check the lights and timer');
  assert.equal(act({ noise: 5, bouts: 0, severity: 0, predawn: 0, heat: 40, darkness: 10 }), 'Early warning: the house was warm at night; check it was aired');
  assert.equal(act(undefined), 'Early warning: check for lights, predators or people in the night');
});

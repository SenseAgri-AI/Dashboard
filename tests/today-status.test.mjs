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
const plain = (v) => JSON.parse(JSON.stringify(v));
const day = (date, hdep, mortality) => ({ date, eggs: 4000, hdep, mortality });
const week = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'].map((d) => day(d, 92, 1));
const base = (extra = {}) => ({ now: NOW, daily: [...week, day('2026-10-30', 92, 1)], lastLogDate: '2026-10-30',
  climate: { temperatureC: 24, humidityPct: 60, co2Ppm: 600 }, waterMeters: [{ name: 'A-frame 1', lastMs: min(20) }, { name: 'A-frame 2', lastMs: min(20) }],
  silos: [{ name: 'Silo 1', low: false }], alerts: [], freshness: [], ...extra });
const line = (lines, key) => lines.find((l) => l.key === key);

test('defaults reuse the existing alert windows', () => {
  const d = T.DEFAULT_TODAY_THRESHOLDS;
  assert.equal(d.staleMinutes.climate.amber, legacy.FEED_STALE_MIN);
  assert.equal(d.logStaleDays.red, legacy.LOG_OVERDUE_DAYS);
  assert.equal(d.feltTempC.amber, thi.THI_SEVERE);
  assert.equal(d.feltTempC.red, thi.THI_EXTREME);
});

test('farm overrides merge deeply and ignore junk values', () => {
  const t = T.mergeThresholds({ staleMinutes: { climate: { amber: 30 } }, co2Ppm: { red: 'x' }, hdepDropPts: { amber: -1 }, extra: 5 });
  assert.equal(t.staleMinutes.climate.amber, 30);
  assert.equal(t.staleMinutes.climate.red, 60);
  assert.equal(t.co2Ppm.red, 1400);
  assert.equal(t.hdepDropPts.amber, 3);
  assert.equal('extra' in t, false);
  assert.deepEqual(plain(T.mergeThresholds(undefined)), plain(T.DEFAULT_TODAY_THRESHOLDS));
});

test('stream freshness: green, amber, red, missing and failed check', () => {
  const f = (m) => T.streamFreshness('climate', 'Climate', m, NOW);
  assert.equal(f(min(5)).rag, 'green');
  assert.equal(f(min(5)).text, 'last reading 5 min ago');
  assert.equal(f(min(15)).rag, 'green'); // boundary: stale only beyond the window
  assert.equal(f(min(16)).rag, 'amber');
  assert.equal(f(min(61)).rag, 'red');
  assert.equal(f(min(180)).text, 'last reading 3 h ago');
  assert.equal(f(null).rag, 'red');
  assert.equal(f(undefined).rag, 'unknown'); // a failed query is never shown as stale
});

test('daily-log freshness uses farm-local days', () => {
  assert.equal(T.logFreshness('2026-10-31', NOW).text, 'logged today');
  assert.equal(T.logFreshness('2026-10-30', NOW).rag, 'green');
  assert.equal(T.logFreshness('2026-10-28', NOW).rag, 'amber'); // 3 days > 2
  assert.equal(T.logFreshness('2026-10-25', NOW).rag, 'red');   // 6 days > 5
  assert.equal(T.logFreshness(null, NOW).rag, 'red');
  assert.equal(T.logFreshness(undefined, NOW).rag, 'unknown');
  // 23:30 UTC on the 30th is already the 31st in SAST
  assert.equal(T.daysSinceLog('2026-10-31', Date.parse('2026-10-30T23:30:00Z')), 0);
});

test('all quiet gives five green lines', () => {
  const lines = T.buildToday(base());
  assert.deepEqual(plain(lines.map((l) => l.key)), ['birds', 'climate', 'water', 'silo', 'data']);
  for (const l of lines) assert.equal(l.rag, 'green', `${l.key}: ${l.text}`);
  assert.equal(line(lines, 'birds').text, 'Lay 92% · 1 death');
});

test('birds: hen-day drop vs recent median', () => {
  assert.equal(line(T.buildToday(base({ daily: [...week, day('2026-10-30', 88, 1)] })), 'birds').rag, 'amber');
  const red = line(T.buildToday(base({ daily: [...week, day('2026-10-30', 85, 1)] })), 'birds');
  assert.equal(red.rag, 'red');
  assert.match(red.text, /down 7 pts/);
  // too little history: no comparison
  assert.equal(line(T.buildToday(base({ daily: [day('2026-10-29', 92, 1), day('2026-10-30', 80, 1)] })), 'birds').rag, 'green');
});

test('birds: deaths vs usual, with a minimum count', () => {
  assert.equal(line(T.buildToday(base({ daily: [...week, day('2026-10-30', 92, 2)] })), 'birds').rag, 'green'); // below minDeaths
  assert.equal(line(T.buildToday(base({ daily: [...week, day('2026-10-30', 92, 3)] })), 'birds').rag, 'red');  // 3x usual of 1
  const zeroWeek = week.map((d) => ({ ...d, mortality: 0 }));
  assert.equal(line(T.buildToday(base({ daily: [...zeroWeek, day('2026-10-30', 92, 1)] })), 'birds').rag, 'green');
  const twoWeek = week.map((d) => ({ ...d, mortality: 2 }));
  const amber = line(T.buildToday(base({ daily: [...twoWeek, day('2026-10-30', 92, 4)] })), 'birds');
  assert.equal(amber.rag, 'amber');
  assert.match(amber.text, /usual 2/);
});

test('birds: stale log and failed load', () => {
  const stale = line(T.buildToday(base({ lastLogDate: '2026-10-27' })), 'birds');
  assert.equal(stale.rag, 'amber');
  assert.equal(stale.action, 'Fill in the daily log');
  assert.equal(line(T.buildToday(base({ daily: undefined })), 'birds').rag, 'unknown');
  assert.equal(line(T.buildToday(base({ daily: [], lastLogDate: null })), 'birds').rag, 'amber');
});

test('climate: felt temperature and CO2 bands', () => {
  const c = (climate) => line(T.buildToday(base({ climate })), 'climate');
  assert.equal(c({ temperatureC: 31, humidityPct: 70, co2Ppm: 600 }).rag, 'amber'); // feels ~29.5
  assert.equal(c({ temperatureC: 32, humidityPct: 70, co2Ppm: 600 }).rag, 'red');
  const co2 = c({ temperatureC: 22, humidityPct: 60, co2Ppm: 1500 });
  assert.equal(co2.rag, 'red');
  assert.equal(co2.action, 'Check fans and inlets now');
  assert.equal(c({ temperatureC: null, humidityPct: null, co2Ppm: null }).rag, 'unknown');
  assert.equal(c({ temperatureC: 6553.5, humidityPct: 60, co2Ppm: null }).rag, 'unknown'); // EM300 junk
  assert.equal(c(undefined).rag, 'unknown');
});

test('alerts escalate their line and never downgrade it', () => {
  const lines = T.buildToday(base({ alerts: [
    { id: 'water_zero_3h#1', category: 'water', severity: 'danger', title: 'Possible water problem — A-frame 1' },
    { id: 'heat_stress#1', category: 'climate', severity: 'info', title: 'fyi' },
    { id: 'power_outage#1', category: 'power', severity: 'danger', title: 'Power / network down' },
  ] }));
  assert.equal(line(lines, 'water').rag, 'red');
  assert.equal(line(lines, 'water').text, 'Possible water problem — A-frame 1');
  assert.equal(line(lines, 'climate').rag, 'green');
  assert.equal(line(lines, 'data').rag, 'red');
});

test('water: per-meter freshness, no meters, failed checks', () => {
  const w = (extra) => line(T.buildToday(base(extra)), 'water');
  const stale = w({ waterMeters: [{ name: 'A-frame 1', lastMs: min(10) }, { name: 'A-frame 2', lastMs: min(400) }] });
  assert.equal(stale.rag, 'red');
  assert.match(stale.text, /^A-frame 2: last reading 7 h ago$/);
  assert.equal(w({ waterMeters: [] }).rag, 'unknown');
  assert.equal(w({ alerts: undefined }).rag, 'unknown'); // can't say "no problems" without the alert feed
});

test('silo: running low only, never a percentage or days left', () => {
  const s = line(T.buildToday(base({ silos: [{ name: 'Silo 1', low: false }, { name: 'Silo 2', low: true }] })), 'silo');
  assert.equal(s.rag, 'amber');
  assert.equal(s.text, 'Silo 2 running low');
  assert.doesNotMatch(s.text, /%|day/);
  assert.equal(line(T.buildToday(base({ silos: undefined })), 'silo').rag, 'unknown');
});

test('data health summarises stale streams and delayed alert checks', () => {
  const freshness = [T.streamFreshness('climate', 'Climate', min(5), NOW), T.streamFreshness('eggCamera', 'Egg camera', min(3000), NOW)];
  const d = line(T.buildToday(base({ freshness })), 'data');
  assert.equal(d.rag, 'amber');
  assert.equal(d.text, 'Egg camera 2 days old');
  assert.equal(line(T.buildToday(base({ alertsStale: true })), 'data').rag, 'amber');
});

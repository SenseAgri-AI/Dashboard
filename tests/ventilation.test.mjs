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
const V = load('src/lib/ventilation.ts', { './thi': thi });
const plain = (v) => JSON.parse(JSON.stringify(v));

const H = 3_600_000;
const NOW = Date.parse('2026-11-01T10:00:00Z'); // 12:00 SAST
const DAY0 = Date.parse('2026-10-24T00:00:00Z') - 2 * H; // local midnight 24 Oct
const sun = Array.from({ length: 12 }, (_, i) => ({ sunrise: DAY0 + i * 24 * H + 5.33 * H, sunset: DAY0 + i * 24 * H + 18.67 * H }));
const localHour = (t) => ((t + 2 * H) % (24 * H)) / H;
const localDay = (t) => Math.floor((t - DAY0) / (24 * H)); // 0 = 24 Oct, 8 = 1 Nov (today)
// Outside: hourly, -8 days … +3 days; `f(localHour, dayIndex)` gives °C.
const outside = (f, rain = () => 0) => Array.from({ length: 12 * 24 }, (_, i) => DAY0 + i * H)
  .map((t) => ({ t, tempC: f(localHour(t), localDay(t)), rhPct: 60, rainPct: rain(localHour(t), localDay(t)), windKmh: 10 }));
// A mild sine day: min at 05:00, max at 15:00.
const sine = (lo, hi) => (h) => lo + (hi - lo) * (0.5 - 0.5 * Math.cos(((h - 5 + 24) % 24) / 10 * Math.PI * (h >= 5 && h <= 15 ? 1 : 0) + (h > 15 || h < 5 ? Math.PI * (1 + ((h - 15 + 24) % 24) / 14) : 0)));
// Inside: 30-min points up to NOW, `f(localHour, dayIndex)` → {tempC, rhPct, co2}.
const inside = (f) => Array.from({ length: Math.floor((NOW - DAY0) / (H / 2)) + 1 }, (_, i) => DAY0 + i * H / 2)
  .map((t) => ({ t, ...f(localHour(t), localDay(t)) }));
const calmInside = () => ({ tempC: 24, rhPct: 60, co2: 900 });
const view = (o, i = inside(calmInside), thresholds) => V.buildVentilation({ now: NOW, outside: o, sun, inside: i, offsetHours: 2, thresholds });
const ids = (v) => plain(v.prompts.map((p) => p.id));

test('defaults and per-farm overrides', () => {
  const t = V.mergeVentThresholds({ coldNightC: 8, hotDayC: 'x', chillOffsetC: 2, bogus: 1 });
  assert.equal(t.coldNightC, 8);
  assert.equal(t.hotDayC, 30);
  assert.equal(t.chillOffsetC, 2);
  assert.equal(t.bogus, undefined);
  assert.equal(V.mergeVentThresholds(undefined).co2Ppm, 1400);
});

test('mild weather: no prompts; day/night rows and a 3-day outlook', () => {
  const v = view(outside(sine(14, 24)));
  assert.deepEqual(ids(v), []);
  assert.equal(v.hasForecast, true);
  assert.equal(v.today.period.kind, 'day');
  assert.equal(v.tonight.period.kind, 'night');
  assert.equal(v.outlook.length, 3);
  assert.deepEqual(plain(v.outlook.map((d) => d.label)), ['Today', 'Tomorrow', 'Tue']);
  assert.ok(v.today.outside.max >= 23 && v.today.outside.max <= 24);
  assert.equal(v.tonight.inside.min, 24); // last night, measured
});

test('inside now: felt temperature and the chill estimate (felt − 3 °C)', () => {
  const v = view(outside(sine(14, 24)), inside(() => ({ tempC: 30, rhPct: 70, co2: 800 })));
  assert.equal(v.insideNow.tempC, 30);
  assert.equal(v.insideNow.feltC, Math.round(thi.thi(30, 70) * 10) / 10);
  assert.equal(v.insideNow.chillEstC, Math.round((thi.thi(30, 70) - 3) * 10) / 10);
  // stale inside (> 90 min) is not shown as "now"
  const stale = inside(calmInside).filter((x) => x.t < NOW - 2 * H);
  assert.equal(view(outside(sine(14, 24)), stale).insideNow, null);
  // ...but the page can still say how old the last reading is
  assert.equal(view(outside(sine(14, 24)), stale).insideLastAt, stale.at(-1).t);
  assert.equal(view(outside(sine(14, 24)), []).insideLastAt, null);
});

test('hot afternoon: fans before the heat, only while heat is still ahead', () => {
  // today: 27.5 °C from 13:00, 33 °C 14:00–17:00 → before 12:00 is now-ish; use a later start
  const later = view(outside((h, d) => (d === 8 ? (h >= 15 && h <= 17 ? 33 : h >= 14 ? 27.5 : 20) : 22)));
  assert.equal(later.prompts.find((x) => x.id === 'hot-day').text, 'Hot afternoon forecast (33 °C around 15:00): consider opening up and fans on before 13:00');
  // already warm: "now"
  const already = view(outside((h, d) => (d === 8 ? (h >= 11 && h <= 17 ? 33 : 20) : 22)));
  assert.match(already.prompts.find((x) => x.id === 'hot-day').text, /fans on now$/);
  // heat over for today and a mild tomorrow → nothing
  assert.ok(!ids(view(outside((h, d) => (d === 8 && h < 11 ? 33 : 22)))).includes('hot-day'));
  // tomorrow: planned, not urgent
  const tmr = view(outside((h, d) => (d === 9 && h >= 10 && h <= 16 ? 34 : 20)));
  assert.equal(tmr.prompts[0].text, 'Hot tomorrow forecast (34 °C around 10:00): consider opening up and fans on before 09:00');
  assert.equal(tmr.prompts[0].level, 'plan');
  // below the farm threshold → nothing; with a lower per-farm threshold → prompt
  const warm = outside((h, d) => (d === 8 && h >= 14 && h <= 16 ? 29 : 20));
  assert.ok(!ids(view(warm)).includes('hot-day'));
  assert.ok(ids(view(warm, inside(calmInside), V.mergeVentThresholds({ hotDayC: 28 }))).includes('hot-day'));
});

test('cold night ahead, with the flock baseline', () => {
  const cold = (h, d) => (d === 8 && (h >= 19 || h < 5) ? 8 : d === 9 && h < 5 ? 7 : 18);
  const v = view(outside(cold));
  const p = v.prompts.find((x) => x.id === 'cold-night');
  assert.equal(p.text, 'Cold night ahead (min 7 °C): consider closing curtains and reducing fans by dusk (18:40)');
  // last night inside much colder than usual → mentioned
  const chilly = inside((h, d) => ({ tempC: d === 7 && (h >= 19 || h < 5) || d === 8 && h < 5 ? 15 : 22, rhPct: 60, co2: 900 }));
  assert.match(view(outside(cold), chilly).prompts.find((x) => x.id === 'cold-night').why, /down to 15 °C last night \(usual 22 °C\)/);
  // 11 °C is not a cold night at the default 10 °C, but is with a farm override of 12
  const mild = outside((h, d) => (d === 8 && (h >= 19 || h < 5) ? 11 : 18));
  assert.ok(!ids(view(mild)).includes('cold-night'));
  assert.ok(ids(view(mild, inside(calmInside), V.mergeVentThresholds({ coldNightC: 12 }))).includes('cold-night'));
});

test('high CO₂ with cold outside → minimum ventilation; not when warm outside or not sustained', () => {
  const co2High = inside((h, d) => ({ tempC: 20, rhPct: 60, co2: d === 8 && h >= 10 ? 1650 : 900 }));
  const coldDay = outside(() => 9);
  const v = view(coldDay, co2High);
  assert.equal(v.prompts.find((x) => x.id === 'co2-cold').text.replace(/\u00a0/g, ' '), "High CO₂ (1 650 ppm) with cold outside (9 °C): consider minimum ventilation, don't close fully");
  assert.ok(!ids(view(outside(() => 22), co2High)).includes('co2-cold'));
  const blip = inside((h, d) => ({ tempC: 20, rhPct: 60, co2: d === 8 && h >= 11.75 ? 1650 : 900 }));
  assert.ok(!ids(view(coldDay, blip)).includes('co2-cold'));
});

test('damp night risk only when closing up, vs the flock baseline', () => {
  const cold = outside((h, d) => (d === 8 && (h >= 19 || h < 5) ? 6 : 17));
  const dampLastNight = inside((h, d) => ({ tempC: 20, rhPct: (d === 7 && h >= 19) || (d === 8 && h < 5) ? 86 : 65, co2: 900 }));
  const p = view(cold, dampLastNight).prompts.find((x) => x.id === 'damp-night');
  assert.match(p.text, /^Damp when closed up: inside reached 86% RH last night \(usual 65%\)/);
  assert.ok(!ids(view(outside(() => 17), dampLastNight)).includes('damp-night')); // no cold night → not closing up
});

test('cooler outside now while warm inside → flush heat', () => {
  const v = view(outside(() => 22), inside(() => ({ tempC: 31, rhPct: 60, co2: 800 })));
  assert.equal(v.prompts.find((x) => x.id === 'cooler-outside').text, 'Cooler outside now (22 °C vs 31 °C inside): consider opening up or fans on to flush heat');
  assert.ok(!ids(view(outside(() => 22), inside(() => ({ tempC: 24, rhPct: 60, co2: 800 })))).includes('cooler-outside'));
});

test('best window to air out: mildest dry daylight hours, only when the house will be closed', () => {
  const cold = (h, d) => (d === 8 ? (h >= 13 && h < 16 ? 19 : h >= 12 && h < 17 ? 15 : (h >= 19 ? 6 : 12)) : 6);
  const v = view(outside(cold));
  assert.equal(v.prompts.find((x) => x.id === 'air-out').text, 'Best time to air out today: 13:00–16:00 (outside 19–19 °C)');
  // a long mild afternoon → the warmest 4 h, never past sunset (18:40)
  const long = view(outside((h, d) => (d === 8 ? (h >= 12 && h < 20 ? 17 + (h === 17 || h === 18 ? 4 : h === 16 ? 3 : 0) : (h >= 19 ? 6 : 12)) : 6)));
  assert.equal(long.prompts.find((x) => x.id === 'air-out').text, 'Best time to air out today: 15:00–18:40 (outside 17–21 °C)');
  // rain in that window → no window long enough
  const wet = view(outside(cold, (h, d) => (d === 8 && h >= 14 && h < 15 ? 80 : 0)));
  assert.ok(!ids(wet).includes('air-out'));
  // nothing to air out → no prompt
  assert.ok(!ids(view(outside((h) => (h >= 13 && h < 16 ? 19 : 14)))).includes('air-out'));
});

test('prompts are suggestions and "act" sorts before "plan"', () => {
  const v = view(outside((h, d) => (d === 8 && (h >= 19 || h < 5) ? 6 : d === 8 ? 9 : 6)),
    inside((h, d) => ({ tempC: 20, rhPct: 60, co2: d === 8 && h >= 10 ? 1650 : 900 })));
  assert.ok(v.prompts.length >= 2);
  for (const p of v.prompts) assert.match(p.text, /consider|Best time/);
  const levels = plain(v.prompts.map((p) => p.level));
  assert.deepEqual(levels, [...levels].sort((a, b) => (a === 'act' ? 0 : 1) - (b === 'act' ? 0 : 1)));
});

test('no forecast (no location): inside still shown, no outside prompts', () => {
  const v = V.buildVentilation({ now: NOW, outside: null, sun: [], inside: inside(calmInside), offsetHours: 2 });
  assert.equal(v.hasForecast, false);
  assert.equal(v.insideNow.tempC, 24);
  assert.deepEqual(ids(v), []);
  assert.equal(v.today.period.kind, 'day'); // 06:00/18:00 fallback
});

test('Open-Meteo parsing', () => {
  const p = V.parseOpenMeteo({ hourly: { time: [1, 2], temperature_2m: [10, null], relative_humidity_2m: [50, 60] }, daily: { sunrise: [100], sunset: [200] } });
  assert.deepEqual(plain(p), { outside: [{ t: 1000, tempC: 10, rhPct: 50, rainPct: null, windKmh: null }], sun: [{ sunrise: 100000, sunset: 200000 }] });
  assert.equal(V.parseOpenMeteo({ error: true }), null);
});

test('cold night: felt never above the air, chill = min(actual, felt) − 3', () => {
  assert.ok(thi.thi(10, 60) > 10); // the Marai index reads warm below ~14.4 °C
  assert.equal(thi.feltTemp(10, 60), 10);
  const v = view(outside(() => 8), inside(() => ({ tempC: 10, rhPct: 60, co2: 900 })));
  assert.equal(v.insideNow.feltC, 10);
  assert.equal(v.insideNow.chillEstC, 7);
});

test('hot-day wording uses the farm-local date: before sunrise, today is "afternoon"', () => {
  const early = Date.parse('2026-11-01T02:00:00Z'); // 04:00 SAST, before sunrise
  const o = outside((h, d) => (d === 8 && h >= 11 && h <= 15 ? 33 : 20));
  const v = V.buildVentilation({ now: early, outside: o, sun, inside: inside(calmInside).filter((x) => x.t <= early), offsetHours: 2 });
  const p = v.prompts.find((x) => x.id === 'hot-day');
  assert.match(p.text, /^Hot afternoon forecast \(33 °C around 11:00\): consider opening up and fans on before 10:00$/);
});

test('ventilation CO₂: a lone reading after a gap does not count as sustained', () => {
  const lone = [{ t: NOW - 10 * 60_000, tempC: 20, rhPct: 60, co2: 1800 }];
  assert.equal(V.co2Sustained(lone, NOW, 1400, 60), null);
});

test('3-day outlook labels by local date: in the evening the first day is tomorrow', () => {
  const evening = Date.parse('2026-11-01T19:00:00Z'); // 21:00 SAST
  const v = V.buildVentilation({ now: evening, outside: outside(() => 20), sun, inside: [], offsetHours: 2 });
  assert.deepEqual(plain(v.outlook.map((d) => d.label)), ['Tomorrow', 'Tue', 'Wed']);
});

test('farmId format is checked before it can reach SQL', () => {
  const F = load('src/lib/farms.ts', { '@aws-sdk/client-ssm': {}, '@clerk/nextjs/server': {} });
  for (const ok of ['farm_anike_001', 'farm-x-2', 'a']) assert.equal(F.isValidFarmId(ok), true, ok);
  for (const bad of ["farm' OR 1=1 --", 'Farm_A', 'farm id', '', null, 42, 'x'.repeat(65)]) assert.equal(F.isValidFarmId(bad), false, String(bad));
});

test('device ids in the farm config must be 16-hex devEUIs (or empty)', () => {
  const F = load('src/lib/farms.ts', { '@aws-sdk/client-ssm': {}, '@clerk/nextjs/server': {} });
  const ok = { farmId: 'farm_x_001', waterDeviceId: '0123456789abcdef', feedDeviceId: '' };
  assert.equal(F.farmConfigIdProblem(ok), null);
  assert.equal(F.farmConfigIdProblem({ ...ok, feedDeviceId: 'ABCDEF0123456789' }), null);
  assert.equal(F.farmConfigIdProblem({ ...ok, waterDeviceId: "x' OR '1'='1" }), 'invalid waterDeviceId');
  assert.equal(F.farmConfigIdProblem({ ...ok, feedDeviceId: '0123456789abcde' }), 'invalid feedDeviceId');
  assert.equal(F.farmConfigIdProblem({ ...ok, waterMeters: [{ deviceId: '0123456789abcdef', name: 'A' }] }), null);
  assert.equal(F.farmConfigIdProblem({ ...ok, waterMeters: [{ deviceId: 'nope', name: 'A' }] }), 'invalid waterMeters deviceId');
  assert.equal(F.farmConfigIdProblem({ ...ok, farmId: 'Bad Id' }), 'invalid farmId');
});

test('farm location validation', () => {
  const F = load('src/lib/farms.ts', { '@aws-sdk/client-ssm': {}, '@clerk/nextjs/server': {} });
  assert.deepEqual(plain(F.validLocation({ lat: -25.0, lon: 28.0 })), { lat: -25, lon: 28 }); // placeholder, not a real farm
  assert.equal(F.validLocation({ lat: 'x', lon: 28.0 }), null);
  assert.equal(F.validLocation({ lat: -126, lon: 28.0 }), null);
  assert.equal(F.validLocation(undefined), null);
});

// Ventilation page rules: pure functions, tested in tests/ventilation.test.mjs.
// Outside = Open-Meteo forecast (hourly); inside = the house climate sensor (30-min averages).
// Every prompt is a suggestion ("consider …"), never a claimed cause. Thresholds are per-farm
// (`ventilation` in the farm config) and PROVISIONAL until a farmer or vet confirms them.

import { feltTemp, plausibleClimate } from "./thi";

export type VentThresholds = {
  /** Outside night minimum at or below this → "cold night ahead". */
  coldNightC: number;
  /** Outside day maximum at or above this → "hot afternoon". */
  hotDayC: number;
  /** Fans/opening suggested this many hours before outside first reaches `heatStartC`. */
  heatStartC: number;
  fansLeadHours: number;
  /** "Hot inside likely": outside peak + the house's usual afternoon gain over outside reaches this
   *  (same 32 °C as the Today card's dry-bulb backstop). Gain = median of (inside max − outside max)
   *  over the last `baselineNights` complete days, needing at least `minGainDays`. */
  insideHotC: number;
  minGainDays: number;
  /** Only warm days (outside max at or above this) count towards the gain: on cool days birds' own heat
   *  makes the gap bigger and would overstate it. */
  gainMinOutsideC: number;
  /** Inside CO₂ held at or above this for `co2DwellMinutes` while outside is at or below `co2ColdOutsideC`. */
  co2Ppm: number;
  co2DwellMinutes: number;
  co2ColdOutsideC: number;
  /** Damp risk when closing up: last night's inside RH max at or above this, or this far above the usual. */
  dampRhPct: number;
  dampAboveUsualPts: number;
  /** "Cooler outside now": inside minus outside at least this, while inside feels at least `warmInsideFeltC`. */
  coolerOutsideDeltaC: number;
  warmInsideFeltC: number;
  /** Dry-heat backstop for "cooler outside now": inside air at or above this also counts as warm (the
   *  felt index reads low in dry heat, e.g. 29 °C at 33 % RH feels 26). */
  warmInsideC: number;
  /** Airing-out window: daylight hours with outside in this band and rain chance below `airOutMaxRainPct`. */
  airOutMinC: number;
  airOutMaxC: number;
  airOutMaxRainPct: number;
  /** Daylight hour with at least this rain chance (today's rest or tomorrow) → "Rain likely … be ready to close curtains". */
  stormRainPct: number;
  /** Forecast gusts at/above this around the rain hour → mentioned in the why line. */
  stormGustKmh: number;
  /** Inside this far below the forecast outside temperature now → today's forecast is out of date (e.g. a storm came early): skip today's hot prompt. */
  forecastOffC: number;
  airOutMinHours: number;
  /** The suggested window is the warmest stretch of at most this many hours. */
  airOutMaxHours: number;
  /** Inside night minimum this far below the flock's usual → mention it. */
  colderThanUsualC: number;
  /** Dylan's wind-chill estimate: min(actual, felt) minus this. A rough estimate, not a model. */
  chillOffsetC: number;
  /** Nights used for the flock's own baseline. */
  baselineNights: number;
};

export const DEFAULT_VENT_THRESHOLDS: VentThresholds = {
  coldNightC: 10,          // PROVISIONAL; the summary's inside cold-night warning is 14 / 10 °C
  hotDayC: 30,             // PROVISIONAL
  heatStartC: 27,          // PROVISIONAL
  fansLeadHours: 1,
  insideHotC: 32,          // PROVISIONAL; = Today card dryBulbC.amber
  minGainDays: 4,
  gainMinOutsideC: 24,     // PROVISIONAL
  co2Ppm: 1400,            // same as the Today card (existing danger band)
  co2DwellMinutes: 60,
  co2ColdOutsideC: 15,     // PROVISIONAL
  dampRhPct: 80,           // PROVISIONAL
  dampAboveUsualPts: 10,
  coolerOutsideDeltaC: 3,
  warmInsideFeltC: 27.8,   // THI_COMFORT
  warmInsideC: 29,         // PROVISIONAL
  airOutMinC: 16,          // PROVISIONAL
  airOutMaxC: 28,
  airOutMaxRainPct: 50,
  stormRainPct: 70,        // PROVISIONAL
  stormGustKmh: 50,        // PROVISIONAL
  forecastOffC: 5,         // houses here run at or above outside by day
  airOutMinHours: 2,
  airOutMaxHours: 4,
  colderThanUsualC: 3,
  chillOffsetC: 3,
  baselineNights: 7,
};

export type VentThresholdOverrides = Partial<VentThresholds>;

export function mergeVentThresholds(o?: unknown): VentThresholds {
  const out: VentThresholds = { ...DEFAULT_VENT_THRESHOLDS };
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const k of Object.keys(out) as (keyof VentThresholds)[]) {
      const v = (o as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

export type OutsideHour = { t: number; tempC: number; rhPct: number | null; rainPct: number | null; windKmh: number | null; gustKmh?: number | null };
export type InsidePoint = { t: number; tempC: number | null; rhPct: number | null; co2: number | null };
export type SunDay = { sunrise: number; sunset: number };
export type VentInput = {
  now: number;
  outside: OutsideHour[] | null;   // null = no forecast (no location or the API failed)
  sun: SunDay[];                   // ascending
  inside: InsidePoint[];           // ascending, ~30-min buckets, last ~8 days
  offsetHours: number;             // farm local offset (SAST = 2)
  thresholds?: VentThresholds;
};

export type Period = { kind: "day" | "night"; start: number; end: number; label: string };
export type Range = { min: number; max: number } | null;
export type Prompt = { id: string; level: "act" | "plan"; text: string; why: string };
/** `upcoming`: the day hasn't started (it is night now), so `inside` is the previous day, measured.
 *  `when`: the period's farm-local date vs now. `insideWhen`: the date of the `inside` range. */
export type PeriodRow = { period: Period; outside: Range; inside: Range; insideUsual: Range; partial: boolean; upcoming?: boolean;
  when?: "today" | "tomorrow"; insideWhen?: "today" | "yesterday" };
/** Hens drink far more on hot afternoons; a blocked line matters most then. */
const DRINKERS = "Birds drink more in the heat: check drinkers are flowing.";

export type DayOutlook = { label: string; dayMax: number | null; nightMin: number | null; hot: boolean; cold: boolean;
  /** Likely inside peak (outside high + this house's usual warm-day gain); null on cool days or without enough history. */
  insideMax: number | null; insideHot: boolean;
  /** True when `insideMax` is today's measured maximum so far (after the forecast peak), not an estimate. */
  insideMeasured: boolean;
  /** Highest daylight rain chance (%), or null without rain data. */
  rainPct: number | null };

export type VentView = {
  insideNow: { tempC: number; rhPct: number | null; feltC: number | null; chillEstC: number | null; co2: number | null; at: number } | null;
  outsideNow: number | null;
  /** Time of the newest inside temperature, even when too old for "now" (so a stale sensor can say how old). */
  insideLastAt: number | null;
  today: PeriodRow | null;     // current or next daylight period
  tonight: PeriodRow | null;   // the night after it (inside = the previous night, measured)
  outlook: DayOutlook[];       // next 3 days, starting today
  prompts: Prompt[];
  hasForecast: boolean;
};

const H = 3_600_000;
const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function localHHMM(t: number, offsetHours: number): string {
  return new Date(t + offsetHours * H).toISOString().slice(11, 16);
}
const localDate = (t: number, offsetHours: number) => new Date(t + offsetHours * H).toISOString().slice(0, 10);
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (t: number, offsetHours: number) => WEEKDAY[new Date(t + offsetHours * H).getUTCDay()];

/** Day/night periods from sunrise/sunset; falls back to 06:00/18:00 local when sun times are missing. */
export function periods(sun: SunDay[], from: number, to: number, offsetHours: number): Period[] {
  let days = sun.filter((d) => Number.isFinite(d.sunrise) && Number.isFinite(d.sunset) && d.sunset > d.sunrise);
  if (!days.length) {
    days = [];
    const midnight = Date.parse(`${localDate(from, offsetHours)}T00:00:00Z`) - offsetHours * H;
    for (let m = midnight - 24 * H; m <= to + 24 * H; m += 24 * H) days.push({ sunrise: m + 6 * H, sunset: m + 18 * H });
  }
  const out: Period[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    out.push({ kind: "day", start: d.sunrise, end: d.sunset, label: weekday(d.sunrise, offsetHours) });
    const next = days[i + 1]?.sunrise ?? d.sunrise + 24 * H;
    out.push({ kind: "night", start: d.sunset, end: next, label: `${weekday(d.sunset, offsetHours)} night` });
  }
  return out.filter((p) => p.end > from && p.start < to);
}

function rangeOf(vals: number[]): Range {
  return vals.length ? { min: r1(Math.min(...vals)), max: r1(Math.max(...vals)) } : null;
}
const outsideIn = (hours: OutsideHour[], p: Period) => hours.filter((h) => h.t >= p.start && h.t < p.end).map((h) => h.tempC);
const insideIn = (pts: InsidePoint[], p: Period, key: "tempC" | "rhPct" = "tempC") =>
  pts.filter((x) => x.t >= p.start && x.t < p.end).map((x) => x[key]).filter((v): v is number => v != null && Number.isFinite(v));

/** True when every inside CO₂ point in the last `dwell` minutes is ≥ ppm and there are enough of them. */
export function co2Sustained(inside: InsidePoint[], now: number, ppm: number, dwellMinutes: number): number | null {
  const pts = inside.filter((x) => x.t > now - (dwellMinutes + 30) * 60_000 && x.t <= now && x.co2 != null);
  if (pts.length < Math.ceil(dwellMinutes / 30) + 1) return null; // never on a lone reading after a gap
  return pts.every((x) => x.co2! >= ppm) ? pts[pts.length - 1].co2! : null;
}

/** Longest run of consecutive forecast hours inside [start, end) meeting `ok`. */
function longestRun(hours: OutsideHour[], start: number, end: number, ok: (h: OutsideHour) => boolean) {
  let best: OutsideHour[] = [];
  let cur: OutsideHour[] = [];
  for (const h of hours.filter((x) => x.t >= start && x.t < end)) {
    if (ok(h) && (!cur.length || h.t - cur[cur.length - 1].t <= H)) cur.push(h);
    else cur = ok(h) ? [h] : [];
    if (cur.length > best.length) best = [...cur];
  }
  return best;
}

export function buildVentilation(input: VentInput): VentView {
  const t = input.thresholds ?? DEFAULT_VENT_THRESHOLDS;
  const { now, offsetHours } = input;
  const hours = (input.outside ?? []).filter((h) => Number.isFinite(h.tempC) && h.tempC > -30 && h.tempC < 60);
  const inside = input.inside.filter((x) => x.tempC == null || (x.tempC > -20 && x.tempC < 60));

  // Inside now: the latest point within 90 min (older = stale; the Today card's Sensors line covers it).
  const last = [...inside].reverse().find((x) => x.tempC != null);
  const insideNow = last && now - last.t <= 90 * 60_000 ? (() => {
    const felt = last.rhPct != null && plausibleClimate(last.tempC!, last.rhPct) ? r1(feltTemp(last.tempC!, last.rhPct)) : null;
    return { tempC: r1(last.tempC!), rhPct: last.rhPct != null ? r0(last.rhPct) : null, feltC: felt,
      chillEstC: felt != null ? r1(felt - t.chillOffsetC) : null, co2: last.co2 != null ? r0(last.co2) : null, at: last.t };
  })() : null;
  const nowHour = hours.reduce<OutsideHour | null>((b, h) => (Math.abs(h.t - now) < (b ? Math.abs(b.t - now) : Infinity) ? h : b), null);
  const outsideNow = nowHour && Math.abs(nowHour.t - now) <= 90 * 60_000 ? r1(nowHour.tempC) : null;

  const all = periods(input.sun, now - 9 * 24 * H, now + 4 * 24 * H, offsetHours);
  const dayIdx = all.findIndex((p) => p.kind === "day" && p.end > now);
  const day = dayIdx >= 0 ? all[dayIdx] : null;
  const night = dayIdx >= 0 ? all[dayIdx + 1] ?? null : null;
  const pastNights = all.filter((p) => p.kind === "night" && p.end <= now).slice(-(t.baselineNights + 1));
  const lastNight = pastNights.at(-1) ?? null;
  const priorNights = pastNights.slice(0, -1);
  const pastDays = all.filter((p) => p.kind === "day" && p.end <= now).slice(-t.baselineNights);

  const usualNightMin = median(priorNights.map((p) => insideIn(inside, p)).filter((v) => v.length >= 6).map((v) => Math.min(...v)));
  const usualNightMax = median(priorNights.map((p) => insideIn(inside, p)).filter((v) => v.length >= 6).map((v) => Math.max(...v)));
  const usualNightRh = median(priorNights.map((p) => insideIn(inside, p, "rhPct")).filter((v) => v.length >= 6).map((v) => Math.max(...v)));
  const usualDayMax = median(pastDays.map((p) => insideIn(inside, p)).filter((v) => v.length >= 6).map((v) => Math.max(...v)));
  const usualDayMin = median(pastDays.map((p) => insideIn(inside, p)).filter((v) => v.length >= 6).map((v) => Math.min(...v)));

  // After sunset the next day hasn't started, so it has no inside readings yet: show the day that just
  // ended (measured) as the guide, like the night box uses last night.
  const upcoming = day != null && day.start > now;
  const prevDay = pastDays.at(-1) ?? null;
  const today: PeriodRow | null = day ? {
    period: day,
    outside: rangeOf(outsideIn(hours, day)),
    inside: rangeOf(upcoming ? (prevDay ? insideIn(inside, prevDay) : []) : insideIn(inside, { ...day, end: Math.min(day.end, now) })),
    upcoming,
    // Calendar dates, not "before/after sunset": between midnight and sunrise the next day IS today,
    // and the day that just ended is yesterday.
    when: localDate(day.start, offsetHours) === localDate(now, offsetHours) ? "today" : "tomorrow",
    insideWhen: !upcoming || (prevDay && localDate(prevDay.start, offsetHours) === localDate(now, offsetHours)) ? "today" : "yesterday",
    insideUsual: usualDayMax != null && usualDayMin != null ? { min: r1(usualDayMin), max: r1(usualDayMax) } : null,
    partial: day.start < now,
  } : null;
  const lastNightInside = lastNight ? insideIn(inside, lastNight) : [];
  const tonight: PeriodRow | null = night ? {
    period: night,
    outside: rangeOf(outsideIn(hours, night)),
    inside: rangeOf(lastNightInside), // measured last night: the best guide to tonight inside
    insideUsual: usualNightMin != null && usualNightMax != null ? { min: r1(usualNightMin), max: r1(usualNightMax) } : null,
    partial: false,
  } : null;

  // House gain = median (inside max − outside max) over recent warm days. Houses here peak ~3–6 °C above
  // outside, so a 28 °C day can mean ~33 °C inside. Only warm days count: on cool days birds' own heat
  // makes the difference look bigger than it is for a hot afternoon.
  const gains = pastDays.map((p) => {
    const iv = insideIn(inside, p), ov = outsideIn(hours, p);
    return iv.length >= 6 && ov.length >= 6 && Math.max(...ov) >= t.gainMinOutsideC ? Math.max(...iv) - Math.max(...ov) : null;
  }).filter((g): g is number => g != null);
  const houseGain = gains.length >= t.minGainDays ? Math.max(0, median(gains)!) : null;

  // 3-day outlook, today first: outside high/low, plus the likely inside peak on warm days.
  // Signs today's forecast is out of date: the house has just dropped sharply (≥ 4 °C in ~2 h) and sits
  // well below the forecast outside temperature. Both are needed, so a pad-cooled house that simply runs
  // below outside still gets its hot-day prompt.
  const recentMax = Math.max(-Infinity, ...inside.filter((x) => x.tempC != null && x.t >= now - 2.5 * H && x.t <= now - 0.5 * H).map((x) => x.tempC as number));
  const stormCooled = insideNow != null && outsideNow != null && insideNow.tempC <= outsideNow - t.forecastOffC && recentMax - insideNow.tempC >= 4;
  const insideMax = (dayMax: number | null) => (houseGain != null && dayMax != null && dayMax >= t.gainMinOutsideC ? r0(dayMax + houseGain) : null);
  const outlook: DayOutlook[] = [];
  for (let i = Math.max(dayIdx, 0); dayIdx >= 0 && i < all.length && outlook.length < 3; i++) {
    const p = all[i];
    if (p.kind !== "day") continue;
    const n = all[i + 1];
    const dv = outsideIn(hours, p), nv = n ? outsideIn(hours, n) : [];
    const dayMax = dv.length ? r0(Math.max(...dv)) : null;
    const nightMin = nv.length ? r0(Math.min(...nv)) : null;
    // Label by farm-local date: in the evening the next daylight is tomorrow's.
    const dDate = localDate(p.start, offsetHours), today0 = localDate(now, offsetHours), tomorrow0 = localDate(now + 24 * H, offsetHours);
    // Today, once the forecast peak hour has passed (or a storm has cooled the house): the measured inside
    // maximum so far replaces the estimate, so the card shows what happened rather than a guess.
    const dayHours = hours.filter((h) => h.t >= p.start && h.t < p.end);
    const peakT = dayHours.length ? dayHours.reduce((a, b) => (b.tempC > a.tempC ? b : a)).t : null;
    const soFar = insideIn(inside, { ...p, end: Math.min(p.end, now + 1) });
    const measured = dDate === today0 && soFar.length >= 6 && ((peakT != null && now > peakT + H) || stormCooled);
    const inMax = measured ? r0(Math.max(...soFar)) : insideMax(dayMax);
    outlook.push({ label: dDate === today0 ? "Today" : dDate === tomorrow0 ? "Tomorrow" : p.label, dayMax, nightMin,
      hot: dayMax != null && dayMax >= t.hotDayC, cold: nightMin != null && nightMin <= t.coldNightC,
      insideMax: inMax, insideHot: (inMax ?? -Infinity) >= t.insideHotC, insideMeasured: measured,
      rainPct: (() => { const r = hours.filter((h) => h.t >= p.start && h.t < p.end && h.rainPct != null).map((h) => h.rainPct as number); return r.length ? r0(Math.max(...r)) : null; })() });
  }

  // ── Prompts ─────────────────────────────────────────────────────────────────
  const prompts: Prompt[] = [];
  const hhmm = (ms: number) => localHHMM(ms, offsetHours);

  // Hot afternoon (today if the heat is still ahead, otherwise tomorrow). Two triggers: the outside
  // forecast alone is hot, or a warm forecast plus this house's own usual afternoon gain over outside
  // (houses here peak ~3–6 °C above outside, so a 28 °C day can mean ~33 °C inside).
  const hotDays = all.filter((p) => p.kind === "day" && p.end > now).slice(0, 2);
  for (const p of hotDays) {
    const dh = hours.filter((h) => h.t >= p.start && h.t < p.end);
    const ahead = dh.filter((h) => h.t >= now - H); // the heat still to come (current hour included)
    if (!ahead.length) continue;
    // Story: after a storm the house is cool but the forecast still says hot; don't tell me "fans on now".
    // A house this far below the forecast outside temperature means today's forecast is out of date.
    const today = localDate(p.start, offsetHours) === localDate(now, offsetHours);
    if (today && stormCooled) continue;
    const peak = ahead.reduce((a, b) => (b.tempC > a.tempC ? b : a));
    const hotOutside = peak.tempC >= t.hotDayC;
    const insideLikely = houseGain != null && houseGain > 0 && peak.tempC >= t.heatStartC && r0(peak.tempC + houseGain) >= t.insideHotC; // the "about N °C" we show, so text and trigger agree
    if (!hotOutside && !insideLikely) continue;
    // Fans before the outside reaches the level that, with the usual gain, makes the house hot.
    const startC = hotOutside ? t.heatStartC : Math.min(t.heatStartC, t.insideHotC - houseGain!);
    const warmFrom = dh.find((h) => h.tempC >= startC) ?? peak;
    const by = warmFrom.t - t.fansLeadHours * H;
    // Label by the farm's local date (before sunrise, today's daylight is still "today").
    const when = localDate(p.start, offsetHours) === localDate(now, offsetHours) ? "afternoon" : "tomorrow";
    const fans = `consider opening up and fans on ${by > now ? `before ${hhmm(by)}` : "now"}`;
    prompts.push(hotOutside ? { id: "hot-day", level: by - now < 12 * H ? "act" : "plan",
      text: `Hot ${when} forecast (${r0(peak.tempC)} °C around ${hhmm(peak.t)}): ${fans}`,
      why: `Outside reaches ${t.heatStartC} °C from about ${hhmm(warmFrom.t)}. ${DRINKERS}` } : { id: "hot-day", level: by - now < 12 * H ? "act" : "plan",
      text: `Hot inside likely ${when === "afternoon" ? "this afternoon" : "tomorrow"} (about ${r0(peak.tempC + houseGain!)} °C): ${fans}`,
      why: `Forecast ${r0(peak.tempC)} °C outside around ${hhmm(peak.t)}, and on ${gains.length} warm days this past week the house peaked about ${r0(houseGain!)} °C above outside. ${DRINKERS}` });
    break;
  }

  // Story: on a hot day the house is wide open; when a storm is coming I want time to close up before
  // wind and rain blow in and the house chills fast. First daylight hour (rest of today or tomorrow)
  // at or above stormRainPct.
  for (const p of hotDays) {
    const wet = hours.find((h) => h.t >= p.start && h.t < p.end && h.t >= now - H && h.rainPct != null && h.rainPct >= t.stormRainPct);
    if (!wet) continue;
    if (stormCooled && localDate(wet.t, offsetHours) === localDate(now, offsetHours)) continue; // the storm has already come
    const before = hours.filter((h) => h.t >= wet.t - 2 * H && h.t < wet.t).map((h) => h.tempC);
    const after = hours.filter((h) => h.t >= wet.t && h.t <= wet.t + 2 * H).map((h) => h.tempC);
    const from = before.length ? Math.max(...before) : null, to = after.length ? Math.min(...after) : null;
    const day0 = localDate(wet.t, offsetHours) === localDate(now, offsetHours) ? "today" : "tomorrow";
    const gusts = hours.filter((h) => h.t >= wet.t - H && h.t <= wet.t + 2 * H && h.gustKmh != null).map((h) => h.gustKmh as number);
    const gust = gusts.length ? Math.max(...gusts) : null;
    prompts.push({ id: "storm", level: wet.t - now < 3 * H ? "act" : "plan",
      text: `Rain likely ${day0} around ${hhmm(wet.t)} (${r0(wet.rainPct!)}% chance): be ready to close curtains`,
      why: (from != null && to != null && from - to >= 4
        ? `Forecast outside drops from about ${r0(from)} °C to ${r0(to)} °C around then; storms can chill an open house fast.`
        : "Forecast rain chance for that hour; storms can chill an open house fast.")
        + (gust != null && gust >= t.stormGustKmh ? ` Gusts up to about ${r0(gust)} km/h.` : "") });
    break;
  }

  // Cold night ahead (tonight only), with the flock's own last night vs usual.
  const tonightMin = tonight?.outside?.min ?? null;
  const coldNight = night != null && tonightMin != null && tonightMin <= t.coldNightC;
  if (coldNight) {
    const lastMin = lastNightInside.length ? Math.min(...lastNightInside) : null;
    const vsUsual = lastMin != null && usualNightMin != null && lastMin <= usualNightMin - t.colderThanUsualC
      ? ` Inside got down to ${r0(lastMin)} °C last night (usual ${r0(usualNightMin)} °C).` : "";
    prompts.push({ id: "cold-night", level: night!.start - now < 12 * H ? "act" : "plan",
      text: `Cold night ahead (min ${r0(tonightMin!)} °C): consider closing curtains and reducing fans by dusk (${hhmm(night!.start)})`,
      why: `Forecast outside minimum for tonight.${vsUsual}` });
  }

  // High CO₂ while it's cold outside: don't shut the house completely.
  const co2 = co2Sustained(inside, now, t.co2Ppm, t.co2DwellMinutes);
  const coldNow = outsideNow != null && outsideNow <= t.co2ColdOutsideC;
  if (co2 != null && coldNow) {
    prompts.push({ id: "co2-cold", level: "act",
      text: `High CO₂ (${r0(co2).toLocaleString("en-ZA")} ppm) with cold outside (${r0(outsideNow!)} °C): consider minimum ventilation, don't close fully`,
      why: `CO₂ has stayed at or above ${t.co2Ppm.toLocaleString("en-ZA")} ppm for ${t.co2DwellMinutes}+ min.` });
  }

  // Damp/ammonia risk when closing up for a cold night.
  const lastNightRh = lastNight ? insideIn(inside, lastNight, "rhPct") : [];
  const rhMax = lastNightRh.length ? Math.max(...lastNightRh) : null;
  const damp = rhMax != null && (rhMax >= t.dampRhPct || (usualNightRh != null && rhMax >= usualNightRh + t.dampAboveUsualPts));
  if (coldNight && damp) {
    prompts.push({ id: "damp-night", level: "plan",
      text: `Damp when closed up: inside reached ${r0(rhMax!)}% RH last night${usualNightRh != null ? ` (usual ${r0(usualNightRh)}%)` : ""}. Consider keeping minimum ventilation tonight and checking litter and manure`,
      why: "Closed-up houses with damp litter build ammonia; there is no ammonia sensor, so humidity is the proxy." });
  }

  // Cooler outside right now while it's warm inside: flush heat.
  const warmInside = insideNow != null && ((insideNow.feltC != null && insideNow.feltC >= t.warmInsideFeltC) || insideNow.tempC >= t.warmInsideC);
  if (insideNow && warmInside && outsideNow != null && insideNow.tempC - outsideNow >= t.coolerOutsideDeltaC) {
    prompts.push({ id: "cooler-outside", level: "act",
      text: `Cooler outside now (${r0(outsideNow)} °C vs ${r0(insideNow.tempC)} °C inside): consider opening up or fans on to flush heat`,
      why: insideNow.feltC != null && insideNow.feltC >= t.warmInsideFeltC ? `Inside feels ${r0(insideNow.feltC)} °C.`
        : `Inside is ${r0(insideNow.tempC)} °C (dry air, so it "feels" ${insideNow.feltC != null ? `${r0(insideNow.feltC)} °C` : "less"}, but the heat is still there).` });
  }

  // Best window to air out today, only when there's a reason to stay closed otherwise.
  if (day && (coldNight || co2 != null || damp)) {
    const run = longestRun(hours, Math.max(day.start, now), day.end,
      (h) => h.tempC >= t.airOutMinC && h.tempC <= t.airOutMaxC && (h.rainPct == null || h.rainPct < t.airOutMaxRainPct));
    if (run.length >= t.airOutMinHours) {
      // Warmest stretch of at most airOutMaxHours inside the run, ending by sunset.
      const n = Math.max(1, Math.min(run.length, Math.round(t.airOutMaxHours)));
      let bestAt = 0, bestSum = -Infinity;
      for (let i = 0; i + n <= run.length; i++) {
        const sum = run.slice(i, i + n).reduce((a, h) => a + h.tempC, 0);
        if (sum > bestSum) { bestSum = sum; bestAt = i; }
      }
      const win = run.slice(bestAt, bestAt + n);
      const temps = win.map((h) => h.tempC);
      prompts.push({ id: "air-out", level: "plan",
        text: `Best time to air out today: ${hhmm(win[0].t)}–${hhmm(Math.min(win[win.length - 1].t + H, day.end))} (outside ${r0(Math.min(...temps))}–${r0(Math.max(...temps))} °C)`,
        why: "The mildest dry hours of the day, before the house is closed up." });
    }
  }

  const order: Record<Prompt["level"], number> = { act: 0, plan: 1 };
  prompts.sort((a, b) => order[a.level] - order[b.level]);
  return { insideNow, outsideNow, insideLastAt: last?.t ?? null, today, tonight, outlook, prompts, hasForecast: hours.length > 0 };
}

/** Parse an Open-Meteo `/v1/forecast` response requested with `timeformat=unixtime`. */
export function parseOpenMeteo(j: unknown): { outside: OutsideHour[]; sun: SunDay[] } | null {
  const o = j as { hourly?: Record<string, unknown[]>; daily?: Record<string, unknown[]> } | null;
  const h = o?.hourly;
  if (!h || !Array.isArray(h.time) || !Array.isArray(h.temperature_2m)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const outside: OutsideHour[] = [];
  h.time.forEach((tt, i) => {
    const ts = num(tt), temp = num(h.temperature_2m[i]);
    if (ts == null || temp == null) return;
    outside.push({ t: ts * 1000, tempC: temp, rhPct: num(h.relative_humidity_2m?.[i]), rainPct: num(h.precipitation_probability?.[i]), windKmh: num(h.wind_speed_10m?.[i]), gustKmh: num(h.wind_gusts_10m?.[i]) });
  });
  const d = o?.daily;
  const sun: SunDay[] = [];
  if (d && Array.isArray(d.sunrise) && Array.isArray(d.sunset)) {
    d.sunrise.forEach((sr, i) => {
      const a = num(sr), b = num(d.sunset[i]);
      if (a != null && b != null) sun.push({ sunrise: a * 1000, sunset: b * 1000 });
    });
  }
  return { outside, sun };
}

/** The one prompt worth a line on Home: an "act" hot afternoon, storm within 3 h or cold night ahead, or null. */
export function headsUpPrompt(prompts: Prompt[]): Prompt | null {
  return prompts.find((p) => p.level === "act" && (p.id === "hot-day" || p.id === "storm" || p.id === "cold-night")) ?? null;
}

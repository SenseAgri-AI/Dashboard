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
  /** Airing-out window: daylight hours with outside in this band and rain chance below `airOutMaxRainPct`. */
  airOutMinC: number;
  airOutMaxC: number;
  airOutMaxRainPct: number;
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
  co2Ppm: 1400,            // same as the Today card (existing danger band)
  co2DwellMinutes: 60,
  co2ColdOutsideC: 15,     // PROVISIONAL
  dampRhPct: 80,           // PROVISIONAL
  dampAboveUsualPts: 10,
  coolerOutsideDeltaC: 3,
  warmInsideFeltC: 27.8,   // THI_COMFORT
  airOutMinC: 16,          // PROVISIONAL
  airOutMaxC: 28,
  airOutMaxRainPct: 50,
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

export type OutsideHour = { t: number; tempC: number; rhPct: number | null; rainPct: number | null; windKmh: number | null };
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
export type PeriodRow = { period: Period; outside: Range; inside: Range; insideUsual: Range; partial: boolean };
export type DayOutlook = { label: string; dayMax: number | null; nightMin: number | null; hot: boolean; cold: boolean };

export type VentView = {
  insideNow: { tempC: number; rhPct: number | null; feltC: number | null; chillEstC: number | null; co2: number | null; at: number } | null;
  outsideNow: number | null;
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

  const today: PeriodRow | null = day ? {
    period: day,
    outside: rangeOf(outsideIn(hours, day)),
    inside: rangeOf(insideIn(inside, { ...day, end: Math.min(day.end, now) })),
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

  // 3-day outlook (outside only), today first.
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
    outlook.push({ label: dDate === today0 ? "Today" : dDate === tomorrow0 ? "Tomorrow" : p.label, dayMax, nightMin,
      hot: dayMax != null && dayMax >= t.hotDayC, cold: nightMin != null && nightMin <= t.coldNightC });
  }

  // ── Prompts ─────────────────────────────────────────────────────────────────
  const prompts: Prompt[] = [];
  const hhmm = (ms: number) => localHHMM(ms, offsetHours);

  // Hot afternoon (today if the heat is still ahead, otherwise tomorrow).
  const hotDays = all.filter((p) => p.kind === "day" && p.end > now).slice(0, 2);
  for (const p of hotDays) {
    const dh = hours.filter((h) => h.t >= p.start && h.t < p.end);
    const ahead = dh.filter((h) => h.t >= now - H); // the heat still to come (current hour included)
    if (!ahead.length) continue;
    const peak = ahead.reduce((a, b) => (b.tempC > a.tempC ? b : a));
    if (peak.tempC < t.hotDayC) continue;
    const warmFrom = dh.find((h) => h.tempC >= t.heatStartC) ?? peak;
    const by = warmFrom.t - t.fansLeadHours * H;
    // Label by the farm's local date (before sunrise, today's daylight is still "today").
    const when = localDate(p.start, offsetHours) === localDate(now, offsetHours) ? "afternoon" : "tomorrow";
    prompts.push({ id: "hot-day", level: by - now < 12 * H ? "act" : "plan",
      text: `Hot ${when} forecast (${r0(peak.tempC)} °C around ${hhmm(peak.t)}): consider opening up and fans on ${by > now ? `before ${hhmm(by)}` : "now"}`,
      why: `Outside reaches ${t.heatStartC} °C from about ${hhmm(warmFrom.t)}.` });
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
  if (insideNow?.feltC != null && outsideNow != null && insideNow.feltC >= t.warmInsideFeltC && insideNow.tempC - outsideNow >= t.coolerOutsideDeltaC) {
    prompts.push({ id: "cooler-outside", level: "act",
      text: `Cooler outside now (${r0(outsideNow)} °C vs ${r0(insideNow.tempC)} °C inside): consider opening up or fans on to flush heat`,
      why: `Inside feels ${r0(insideNow.feltC)} °C.` });
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
  return { insideNow, outsideNow, today, tonight, outlook, prompts, hasForecast: hours.length > 0 };
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
    outside.push({ t: ts * 1000, tempC: temp, rhPct: num(h.relative_humidity_2m?.[i]), rainPct: num(h.precipitation_probability?.[i]), windKmh: num(h.wind_speed_10m?.[i]) });
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

// "Today" card rules (Home). Pure functions only: callers pass already-fetched farm state and a
// `now` (ms), so the logic is testable and never calls Date.now() during render.
// User stories behind every line: docs/today-card.md.
//
// Thresholds are configurable per farm (FarmConfig.today in SSM) and merged over the defaults
// below. Defaults marked PROVISIONAL still need a backtest on farm data; the rest reuse values
// already used by the dashboard or the platform notifier.
import { thi, plausibleClimate, THI_SEVERE, THI_EXTREME } from "./thi";
import { FEED_STALE_MIN, LOG_OVERDUE_DAYS } from "./legacyAlerts";

export type Rag = "green" | "amber" | "red" | "unknown";
/** Streams the farmer is told about. Sound and the egg camera are SenseAgri ops checks, not shown here. */
export type StreamKey = "climate" | "water" | "silo";

export type TodayThresholds = {
  /** Minutes without a reading before a stream counts as stale (amber) / very stale (red). */
  staleMinutes: Record<StreamKey, { amber: number; red: number }>;
  /** Days since the last DailyLog entry before the Birds line nudges (amber) / insists (red). */
  logStaleDays: { amber: number; red: number };
  /** Felt temperature (°C effective, Marai THI) bands. */
  feltTempC: { amber: number; red: number };
  /** CO₂ is only shown once readings stay at or above `ppm` for `dwellMinutes`. */
  co2Sustained: { ppm: number; dwellMinutes: number };
  /** Hen-day % drop (percentage points) of the latest log vs the median of the previous days. */
  hdepDropPts: { amber: number; red: number; baselineDays: number; minBaselineDays: number };
  /** Deaths on the latest log vs the mean of the previous days. */
  mortality: { amberFactor: number; redFactor: number; minDeaths: number; baselineDays: number };
};

export const DEFAULT_TODAY_THRESHOLDS: TodayThresholds = {
  staleMinutes: {
    // Same 15-min window as the power/connectivity alert (climate reports ~1/min); red after 1 h.
    climate: { amber: FEED_STALE_MIN, red: 60 },
    // PROVISIONAL: EM300 / EM411 uplink cadence is not fixed in code. The radar is sparse, so its
    // window is deliberately long to avoid false "stale" lines.
    water: { amber: 90, red: 6 * 60 },
    silo: { amber: 48 * 60, red: 96 * 60 },
  },
  // Nudge matches the old Home attention list (> 2 days); red matches the notifier's overdue alert (> 5).
  logStaleDays: { amber: 2, red: LOG_OVERDUE_DAYS },
  // Same severe / extreme zones the heat alert uses (28.9 / 30 °C).
  feltTempC: { amber: THI_SEVERE, red: THI_EXTREME },
  // 1400 ppm = the existing danger band in thresholds.ts. Dwell is PROVISIONAL.
  co2Sustained: { ppm: 1400, dwellMinutes: 60 },
  // PROVISIONAL — needs a backtest against the DailyLog history.
  hdepDropPts: { amber: 3, red: 6, baselineDays: 7, minBaselineDays: 3 },
  mortality: { amberFactor: 2, redFactor: 3, minDeaths: 3, baselineDays: 7 },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type TodayThresholdOverrides = DeepPartial<TodayThresholds>;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge per-farm overrides over the defaults. Unknown keys and non-finite / negative numbers are ignored. */
export function mergeThresholds(overrides?: unknown, base: TodayThresholds = DEFAULT_TODAY_THRESHOLDS): TodayThresholds {
  const merge = (b: unknown, o: unknown): unknown => {
    if (isObj(b)) {
      const out: Record<string, unknown> = { ...b };
      if (isObj(o)) for (const k of Object.keys(b)) if (k in o) out[k] = merge(b[k], o[k]);
      return out;
    }
    return typeof o === "number" && Number.isFinite(o) && o >= 0 ? o : b;
  };
  return merge(base, overrides) as TodayThresholds;
}

const RANK: Record<Rag, number> = { unknown: 0, green: 1, amber: 2, red: 3 };
export function worst(...rags: Rag[]): Rag {
  return rags.reduce<Rag>((a, b) => (RANK[b] > RANK[a] ? b : a), "unknown");
}
const needsYou = (r: Rag) => r === "amber" || r === "red";

// ── Freshness ────────────────────────────────────────────────────────────────

export type Freshness = { stream: StreamKey | "dailyLog"; label: string; rag: Rag; text: string; ageMinutes: number | null };

export function ageText(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  if (h < 36) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/**
 * Freshness of a telemetry stream from its last reading time.
 * `lastMs === undefined` = the check failed (unknown, never "stale");
 * `lastMs === null` = the check worked and found nothing in the lookback window.
 */
export function streamFreshness(stream: StreamKey, label: string, lastMs: number | null | undefined, now: number,
  t: TodayThresholds = DEFAULT_TODAY_THRESHOLDS): Freshness {
  if (lastMs === undefined) return { stream, label, rag: "unknown", text: "couldn't check", ageMinutes: null };
  if (lastMs === null || !Number.isFinite(lastMs)) return { stream, label, rag: "red", text: "no data this week", ageMinutes: null };
  const age = Math.max(0, (now - lastMs) / 60_000);
  const w = t.staleMinutes[stream];
  const rag: Rag = age > w.red ? "red" : age > w.amber ? "amber" : "green";
  return { stream, label, rag, text: `no data for ${ageText(age)}`, ageMinutes: age };
}

/** Whole farm-local days between a YYYY-MM-DD log date and `now` (farm offset in hours). */
export function daysSinceLog(dateKey: string, now: number, offsetHours = 2): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const today = new Date(now + offsetHours * 3_600_000).toISOString().slice(0, 10);
  const diff = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dateKey}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : null;
}

/** `lastLogDate === undefined` = couldn't check; `null` = no entries. */
export function logFreshness(lastLogDate: string | null | undefined, now: number, t: TodayThresholds = DEFAULT_TODAY_THRESHOLDS, offsetHours = 2): Freshness {
  const base = { stream: "dailyLog" as const, label: "Daily log" };
  if (lastLogDate === undefined) return { ...base, rag: "unknown", text: "couldn't check", ageMinutes: null };
  const d = lastLogDate ? daysSinceLog(lastLogDate, now, offsetHours) : null;
  if (d == null) return { ...base, rag: "red", text: "no log yet", ageMinutes: null };
  const rag: Rag = d > t.logStaleDays.red ? "red" : d > t.logStaleDays.amber ? "amber" : "green";
  const text = d === 0 ? "logged today" : d === 1 ? "logged yesterday" : `log missing ${d} days`;
  return { ...base, rag, text, ageMinutes: d * 1440 };
}

// ── Lines ────────────────────────────────────────────────────────────────────

export type LineKey = "birds" | "climate" | "water" | "silo" | "data" | `extra:${string}`;
export type TodayLine = { key: LineKey; label: string; rag: Rag; text: string; action: string };

export type DailyRow = { date: string; eggs: number; hdep: number | null; mortality: number; liveHens?: number };
export type FarmAlert = { id: string; category: string; severity: "info" | "warning" | "danger"; title: string };
export type SiloState = { name: string; low: boolean };
export type WaterMeterFreshness = { name: string; lastMs: number | null | undefined };
export type SeriesPoint = { time: string; value: number };
/** Home attention-list items (src/lib/attention.ts) folded into the card. */
export type ExtraItem = { id: string; severity: "info" | "warning" | "danger"; title: string; detail: string };

export type TodayInput = {
  now: number;
  /** DailyLog-derived daily rows (counted eggs, NOT the egg camera). undefined = failed to load. */
  daily?: DailyRow[];
  lastLogDate?: string | null;
  /** Latest-hour climate averages + the 24 h CO₂ series (30-min buckets). undefined = failed. */
  climate?: { temperatureC: number | null; humidityPct: number | null; co2Series: SeriesPoint[] };
  /** undefined = freshness endpoint failed. */
  climateLastMs?: number | null;
  siloLastMs?: number | null;
  waterMeters?: WaterMeterFreshness[];
  /** undefined = silo endpoint failed. */
  silos?: SiloState[];
  /** Firing alerts from /api/alerts; undefined = feed unavailable. */
  alerts?: FarmAlert[];
  alertsStale?: boolean;
  /** Extra items from the Home attention rules; only warning/danger ones become lines. */
  extras?: ExtraItem[];
  offsetHours?: number;
};

const ALERT_RAG = { danger: "red", warning: "amber", info: "green" } as const;
const CATEGORY_LINE: Record<string, LineKey> = { climate: "climate", water: "water", power: "data", welfare: "birds", reminder: "birds" };
const LOG_ALERT = /^(logs_overdue|egg_log_overdue)/; // the Birds line already covers the daily log

function alertsFor(alerts: FarmAlert[] | undefined, key: LineKey): FarmAlert[] {
  return (alerts ?? []).filter((a) => CATEGORY_LINE[a.category] === key && !LOG_ALERT.test(a.id));
}

/** Apply the worst firing alert of a line if it is worse than the line's own rule (never downgrade). */
function withAlerts(line: TodayLine, alerts: FarmAlert[], action: string): TodayLine {
  const top = [...alerts].sort((a, b) => RANK[ALERT_RAG[b.severity]] - RANK[ALERT_RAG[a.severity]])[0];
  if (!top || RANK[ALERT_RAG[top.severity]] <= RANK[line.rag]) return line;
  return { ...line, rag: ALERT_RAG[top.severity], text: top.title, action };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Story: when lay rate or deaths move against my own last week, or I forgot the log, tell me today. */
export function birdsLine(input: TodayInput, t: TodayThresholds): TodayLine {
  const base = { key: "birds" as const, label: "Birds" };
  const welfare = alertsFor(input.alerts, "birds");
  if (!input.daily) return withAlerts({ ...base, rag: "unknown", text: "", action: "" }, welfare, "Check the birds");
  const rows = [...input.daily].sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows.at(-1);
  if (!latest) return { ...base, rag: "amber", text: "No daily log yet", action: "Log today's eggs and deaths" };

  const parts: string[] = [];
  let rag: Rag = "green";
  let action = "No action needed";

  const priorHdep = rows.slice(0, -1).slice(-t.hdepDropPts.baselineDays)
    .map((r) => r.hdep).filter((v): v is number => v != null && Number.isFinite(v));
  if (latest.hdep != null) {
    let s = `Lay ${r1(latest.hdep)}%`;
    if (priorHdep.length >= t.hdepDropPts.minBaselineDays) {
      const drop = median(priorHdep) - latest.hdep;
      if (drop >= t.hdepDropPts.amber) {
        rag = drop >= t.hdepDropPts.red ? "red" : "amber";
        s += `, down ${r1(drop)} pts`;
        action = "Check water, feed and the birds today";
      }
    }
    parts.push(s);
  }

  const priorDeaths = rows.slice(0, -1).slice(-t.mortality.baselineDays).map((r) => r.mortality);
  const avg = priorDeaths.length ? priorDeaths.reduce((a, b) => a + b, 0) / priorDeaths.length : null;
  let m = `${latest.mortality} ${latest.mortality === 1 ? "death" : "deaths"}`;
  if (avg != null && latest.mortality >= t.mortality.minDeaths) {
    const ref = Math.max(avg, 0.5); // a zero baseline must not turn one bird into an "infinite" rise
    const mRag: Rag = latest.mortality >= ref * t.mortality.redFactor ? "red" : latest.mortality >= ref * t.mortality.amberFactor ? "amber" : "green";
    if (mRag !== "green") {
      m += ` (usual ${r1(avg)})`;
      if (RANK[mRag] >= RANK[rag]) action = mRag === "red" ? "Check for sick birds; call the vet" : "Check for sick or dead birds";
      rag = worst(rag, mRag);
    }
  }
  parts.push(m);

  let line: TodayLine = { ...base, rag, text: parts.join(" · "), action };
  const log = logFreshness(input.lastLogDate, input.now, t, input.offsetHours);
  if (needsYou(log.rag)) {
    line = { ...line, rag: worst(line.rag, log.rag), text: `${line.text} · ${log.text}`, action: rag === "green" ? "Fill in the daily log" : line.action };
  }
  return withAlerts(line, welfare, "Check the birds");
}

/** True when every CO₂ point in the dwell window is at/above the threshold and the window is covered. */
export function co2Sustained(series: SeriesPoint[], now: number, t: TodayThresholds, bucketMinutes = 30): number | null {
  const { ppm, dwellMinutes } = t.co2Sustained;
  const from = now - (dwellMinutes + bucketMinutes) * 60_000; // allow for the current, partial bucket
  const pts = series.filter((p) => Date.parse(p.time) >= from && Number.isFinite(p.value));
  if (pts.length < Math.max(1, Math.ceil(dwellMinutes / bucketMinutes))) return null;
  return pts.every((p) => p.value >= ppm) ? pts[pts.length - 1].value : null;
}

/** Story: when the house is getting hot or the air stays bad, give me one number and what to do. */
export function climateLine(input: TodayInput, t: TodayThresholds): TodayLine {
  const base = { key: "climate" as const, label: "Climate" };
  const alerts = alertsFor(input.alerts, "climate");
  const c = input.climate;
  const temp = c?.temperatureC, rh = c?.humidityPct;
  const felt = temp != null && rh != null && plausibleClimate(temp, rh) ? thi(temp, rh) : null;
  const co2 = c ? co2Sustained(c.co2Series, input.now, t) : null;
  if (felt == null && co2 == null) return withAlerts({ ...base, rag: "unknown", text: "", action: "" }, alerts, "Cool the house now");
  const parts: string[] = [];
  let rag: Rag = "green";
  let action = "No action needed";
  if (felt != null) {
    parts.push(`Feels ${r1(felt)}°C`);
    const fRag: Rag = felt >= t.feltTempC.red ? "red" : felt >= t.feltTempC.amber ? "amber" : "green";
    if (fRag !== "green") { rag = fRag; action = fRag === "red" ? "Max ventilation and cool water now" : "Increase airflow, keep water cool"; }
  }
  if (co2 != null) {
    parts.push(`CO₂ ${Math.round(co2).toLocaleString("en-ZA")} ppm for ${t.co2Sustained.dwellMinutes}+ min`);
    if (rag !== "red") action = "Check fans and inlets now";
    rag = "red";
  }
  return withAlerts({ ...base, rag, text: parts.join(" · "), action }, alerts, "Cool the house now");
}

/** Story: when a water line fails, tell me which A-frame. Shown only on a problem. */
export function waterLine(input: TodayInput): TodayLine {
  const line: TodayLine = { key: "water", label: "Water", rag: "green", text: "", action: "" };
  return withAlerts(line, alertsFor(input.alerts, "water"), "Check water supply and pressure");
}

/** Story: when a silo is running low, tell me which one so I order feed. Shown only when low. */
export function siloLine(input: TodayInput): TodayLine {
  const low = (input.silos ?? []).filter((s) => s.low);
  if (!low.length) return { key: "silo", label: "Feed silo", rag: "green", text: "", action: "" };
  return { key: "silo", label: "Feed silo", rag: "amber", text: `${low.map((s) => s.name).join(" & ")} running low`, action: "Order feed" };
}

/** Story: when sensors stop reporting, tell me plainly so I don't trust old numbers. Shown only on a problem. */
export function dataLine(input: TodayInput, t: TodayThresholds): TodayLine {
  const base = { key: "data" as const, label: "Sensors" };
  const fresh = [
    streamFreshness("climate", "Climate", input.climateLastMs, input.now, t),
    ...(input.waterMeters ?? []).map((m) => streamFreshness("water", `Water (${m.name})`, m.lastMs, input.now, t)),
    streamFreshness("silo", "Silo", input.siloLastMs, input.now, t),
  ];
  const stale = fresh.filter((f) => needsYou(f.rag));
  let line: TodayLine = stale.length
    ? { ...base, rag: worst(...stale.map((f) => f.rag)), text: stale.map((f) => `${f.label}: ${f.text}`).join(" · "), action: "Check power and that device" }
    : { ...base, rag: "green", text: "", action: "" };
  if (input.alertsStale && line.rag === "green") line = { ...line, rag: "amber", text: "Farm alerts are delayed", action: "Tell SenseAgri" };
  return withAlerts(line, alertsFor(input.alerts, "data"), "Check the shed power now");
}

export type TodayResult = {
  /** "All good", "Nothing flagged" (when some checks failed) or "N things need you today". */
  headline: string;
  problems: number;
  lines: TodayLine[];
  /** True when any input failed to load — shown as one footer, never as a green line. */
  someChecksFailed: boolean;
};

export function buildToday(input: TodayInput, overrides?: unknown): TodayResult {
  const t = mergeThresholds(overrides);
  const always = [birdsLine(input, t), climateLine(input, t)].filter((l) => l.rag !== "unknown");
  const onProblem = [waterLine(input), siloLine(input), dataLine(input, t)].filter((l) => needsYou(l.rag));
  const extras: TodayLine[] = (input.extras ?? [])
    .filter((e) => e.severity !== "info" && e.id !== "daily-log") // the Birds line already nudges the log
    .map((e) => ({ key: `extra:${e.id}`, label: "Farm", rag: e.severity === "danger" ? "red" : "amber", text: e.title, action: e.detail }));
  const lines = [...always, ...onProblem, ...extras];
  const problems = lines.filter((l) => needsYou(l.rag)).length;
  const someChecksFailed = input.daily === undefined || input.climate === undefined || input.silos === undefined
    || input.alerts === undefined || input.climateLastMs === undefined || input.siloLastMs === undefined
    || input.waterMeters === undefined || input.waterMeters.some((m) => m.lastMs === undefined);
  const headline = problems === 0 ? (someChecksFailed ? "Nothing flagged" : "All good")
    : `${problems} ${problems === 1 ? "thing needs" : "things need"} you today`;
  return { headline, problems, lines, someChecksFailed };
}

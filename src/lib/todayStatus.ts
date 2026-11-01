// "Today in 30 seconds" + data-freshness rules. Pure functions only: callers pass already-fetched
// farm state and a `now` (ms), so the logic is testable and never calls Date.now() during render.
//
// Thresholds are configurable per farm (FarmConfig.today in SSM) and merged over the defaults
// below. Defaults marked PROVISIONAL are starting points that still need a backtest on farm data;
// the rest reuse values already used elsewhere in the dashboard or the platform notifier.
import { thi, plausibleClimate, THI_SEVERE, THI_EXTREME } from "./thi";
import { FEED_STALE_MIN, LOG_OVERDUE_DAYS } from "./legacyAlerts";

export type Rag = "green" | "amber" | "red" | "unknown";
export type StreamKey = "climate" | "water" | "silo" | "audio" | "dailyLog" | "eggCamera";

export type TodayThresholds = {
  /** Minutes without a reading before a stream goes amber / red. */
  staleMinutes: Record<Exclude<StreamKey, "dailyLog">, { amber: number; red: number }>;
  /** Days since the last DailyLog entry before it goes amber / red. */
  logStaleDays: { amber: number; red: number };
  /** Felt temperature (°C effective, Marai THI) bands. */
  feltTempC: { amber: number; red: number };
  /** CO₂ ppm bands. */
  co2Ppm: { amber: number; red: number };
  /** Hen-day % drop (percentage points) of the latest log vs the median of the previous days. */
  hdepDropPts: { amber: number; red: number; baselineDays: number; minBaselineDays: number };
  /** Deaths on the latest log vs the mean of the previous days. */
  mortality: { amberFactor: number; redFactor: number; minDeaths: number; baselineDays: number };
};

export const DEFAULT_TODAY_THRESHOLDS: TodayThresholds = {
  staleMinutes: {
    // Same 15-min window as the power/connectivity alert (feeds report ~1/min); red after 1 h.
    climate: { amber: FEED_STALE_MIN, red: 60 },
    audio: { amber: FEED_STALE_MIN, red: 60 },
    // PROVISIONAL: EM300 / EM411 uplink cadence is not fixed in code; the water rules need an
    // hourly heartbeat, the radar is sparse, the egg camera only reports while the belt runs.
    water: { amber: 90, red: 6 * 60 },
    silo: { amber: 12 * 60, red: 48 * 60 },
    eggCamera: { amber: 26 * 60, red: 50 * 60 },
  },
  // Amber matches the Home attention list (> 2 days); red matches the notifier's overdue alert (> 5).
  logStaleDays: { amber: 2, red: LOG_OVERDUE_DAYS },
  // Same severe / extreme zones the heat alert uses (28.9 / 30 °C).
  feltTempC: { amber: THI_SEVERE, red: THI_EXTREME },
  // Same bands as src/lib/thresholds.ts co2Status (800 / 1400 ppm).
  co2Ppm: { amber: 800, red: 1400 },
  // PROVISIONAL — needs a backtest against the DailyLog history.
  hdepDropPts: { amber: 3, red: 6, baselineDays: 7, minBaselineDays: 3 },
  mortality: { amberFactor: 2, redFactor: 3, minDeaths: 3, baselineDays: 7 },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type TodayThresholdOverrides = DeepPartial<TodayThresholds>;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge per-farm overrides over the defaults. Non-finite / non-positive numbers are ignored. */
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

// ── Freshness ────────────────────────────────────────────────────────────────

export type Freshness = { stream: StreamKey; label: string; rag: Rag; text: string; ageMinutes: number | null };

export function ageText(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const h = minutes / 60;
  if (h < 36) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/**
 * Freshness of a telemetry stream from its last reading time.
 * `lastMs === undefined` means the check itself failed (unknown, never "stale");
 * `lastMs === null` means the check worked and found nothing in the lookback window.
 */
export function streamFreshness(
  stream: Exclude<StreamKey, "dailyLog">, label: string, lastMs: number | null | undefined, now: number,
  t: TodayThresholds = DEFAULT_TODAY_THRESHOLDS,
): Freshness {
  if (lastMs === undefined) return { stream, label, rag: "unknown", text: "couldn't check", ageMinutes: null };
  if (lastMs === null || !Number.isFinite(lastMs)) return { stream, label, rag: "red", text: "no recent reading", ageMinutes: null };
  const age = Math.max(0, (now - lastMs) / 60_000);
  const w = t.staleMinutes[stream];
  const rag: Rag = age > w.red ? "red" : age > w.amber ? "amber" : "green";
  return { stream, label, rag, text: `last reading ${ageText(age)}`, ageMinutes: age };
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
  if (d == null) return { ...base, rag: "red", text: "no entries yet", ageMinutes: null };
  const rag: Rag = d > t.logStaleDays.red ? "red" : d > t.logStaleDays.amber ? "amber" : "green";
  const text = d === 0 ? "logged today" : d === 1 ? "last log yesterday" : `last log ${d} days ago`;
  return { ...base, rag, text, ageMinutes: d * 1440 };
}

// ── Today lines ──────────────────────────────────────────────────────────────

export type TodayLine = { key: "birds" | "climate" | "water" | "silo" | "data"; label: string; rag: Rag; text: string; action: string };

export type DailyRow = { date: string; eggs: number; hdep: number | null; mortality: number; liveHens?: number };
export type FarmAlert = { id: string; category: string; severity: "info" | "warning" | "danger"; title: string };
export type SiloState = { name: string; low: boolean };
export type WaterMeterFreshness = { name: string; lastMs: number | null | undefined };

export type TodayInput = {
  now: number;
  /** DailyLog-derived daily rows (counted eggs, NOT the egg camera), any order. undefined = failed. */
  daily?: DailyRow[];
  lastLogDate?: string | null;
  /** Latest-hour climate averages; undefined = failed / no data. */
  climate?: { temperatureC: number | null; humidityPct: number | null; co2Ppm: number | null };
  waterMeters?: WaterMeterFreshness[];
  /** undefined = silo endpoint failed. */
  silos?: SiloState[];
  /** Firing alerts from /api/alerts; undefined = feed unavailable. */
  alerts?: FarmAlert[];
  alertsStale?: boolean;
  freshness: Freshness[];
};

const ALERT_RAG = { danger: "red", warning: "amber", info: "green" } as const;
const CATEGORY_LINE: Record<string, TodayLine["key"]> = {
  climate: "climate", water: "water", power: "data", welfare: "birds", reminder: "birds",
};

function alertsFor(alerts: FarmAlert[] | undefined, key: TodayLine["key"]): FarmAlert[] {
  return (alerts ?? []).filter((a) => (CATEGORY_LINE[a.category] ?? null) === key);
}

/** Apply the worst firing alert of a line if it is worse than the line's own rule. */
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

export function birdsLine(input: TodayInput, t: TodayThresholds): TodayLine {
  const base = { key: "birds" as const, label: "Birds" };
  const log = logFreshness(input.lastLogDate, input.now, t);
  const welfare = alertsFor(input.alerts, "birds").filter((a) => !/^(logs_overdue|egg_log_overdue)/.test(a.id)); // log age is handled below
  if (!input.daily) return withAlerts({ ...base, rag: "unknown", text: "Couldn't load the daily log", action: "Try again later" }, welfare, "Check the birds");
  const rows = [...input.daily].sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows.at(-1);
  if (!latest) return { ...base, rag: "amber", text: "No daily log yet", action: "Fill in today's eggs and deaths" };

  const parts: string[] = [];
  let rag: Rag = "green";
  let action = "No action needed";

  // Lay rate vs the flock's own recent level.
  const prior = rows.slice(0, -1).slice(-t.hdepDropPts.baselineDays);
  const priorHdep = prior.map((r) => r.hdep).filter((v): v is number => v != null && Number.isFinite(v));
  if (latest.hdep != null) {
    let s = `Lay ${r1(latest.hdep)}%`;
    if (priorHdep.length >= t.hdepDropPts.minBaselineDays) {
      const drop = median(priorHdep) - latest.hdep;
      if (drop >= t.hdepDropPts.red || drop >= t.hdepDropPts.amber) {
        rag = drop >= t.hdepDropPts.red ? "red" : "amber";
        s += `, down ${r1(drop)} pts`;
        action = "Check water, feed and the birds today";
      }
    }
    parts.push(s);
  }

  // Deaths vs the recent average.
  const priorDeaths = rows.slice(0, -1).slice(-t.mortality.baselineDays).map((r) => r.mortality);
  const avg = priorDeaths.length ? priorDeaths.reduce((a, b) => a + b, 0) / priorDeaths.length : null;
  let m = `${latest.mortality} ${latest.mortality === 1 ? "death" : "deaths"}`;
  if (avg != null && latest.mortality >= t.mortality.minDeaths) {
    const ref = Math.max(avg, 0.5); // a zero baseline must not make one bird an "infinite" rise
    const mRag: Rag = latest.mortality >= ref * t.mortality.redFactor ? "red" : latest.mortality >= ref * t.mortality.amberFactor ? "amber" : "green";
    if (mRag !== "green") {
      m += ` (usual ${r1(avg)})`;
      if (RANK[mRag] >= RANK[rag]) action = mRag === "red" ? "Check for sick birds; call the vet" : "Check for sick or dead birds";
      rag = worst(rag, mRag);
    }
  }
  parts.push(m);

  let line: TodayLine = { ...base, rag, text: parts.join(" · "), action };
  if (log.rag === "amber" || log.rag === "red") {
    line = { ...line, rag: worst(line.rag, "amber"), text: `${line.text} · ${log.text}`, action: rag === "green" ? "Fill in the daily log" : line.action };
  }
  return withAlerts(line, welfare, "Check the birds");
}

export function climateLine(input: TodayInput, t: TodayThresholds): TodayLine {
  const base = { key: "climate" as const, label: "Climate" };
  const c = input.climate;
  const alerts = alertsFor(input.alerts, "climate");
  const temp = c?.temperatureC, rh = c?.humidityPct, co2 = c?.co2Ppm;
  const felt = temp != null && rh != null && plausibleClimate(temp, rh) ? thi(temp, rh) : null;
  if (felt == null && (co2 == null || !Number.isFinite(co2))) {
    return withAlerts({ ...base, rag: "unknown", text: "No recent climate reading", action: "Check the climate sensor" }, alerts, "Cool the house now");
  }
  const parts: string[] = [];
  let rag: Rag = "green";
  let action = "No action needed";
  if (felt != null) {
    const fRag: Rag = felt >= t.feltTempC.red ? "red" : felt >= t.feltTempC.amber ? "amber" : "green";
    parts.push(`Feels ${r1(felt)}°C`);
    if (fRag !== "green") { rag = fRag; action = fRag === "red" ? "Max ventilation and cool water now" : "Increase airflow, keep water cool"; }
  }
  if (co2 != null && Number.isFinite(co2)) {
    const cRag: Rag = co2 >= t.co2Ppm.red ? "red" : co2 >= t.co2Ppm.amber ? "amber" : "green";
    parts.push(`CO₂ ${Math.round(co2).toLocaleString("en-ZA")} ppm`);
    if (RANK[cRag] > RANK[rag]) action = cRag === "red" ? "Check fans and inlets now" : "Increase ventilation";
    rag = worst(rag, cRag);
  }
  return withAlerts({ ...base, rag, text: parts.join(" · "), action }, alerts, "Cool the house now");
}

export function waterLine(input: TodayInput, t: TodayThresholds): TodayLine {
  const base = { key: "water" as const, label: "Water" };
  const alerts = alertsFor(input.alerts, "water");
  const meters = input.waterMeters ?? [];
  if (!meters.length) return withAlerts({ ...base, rag: "unknown", text: "No water meters set up", action: "Ask SenseAgri to link the meters" }, alerts, "Check water supply and pressure");
  const fresh = meters.map((m) => ({ m, f: streamFreshness("water", m.name, m.lastMs, input.now, t) }));
  const bad = fresh.filter((x) => x.f.rag === "amber" || x.f.rag === "red");
  let line: TodayLine;
  if (bad.length) {
    line = { ...base, rag: worst(...bad.map((x) => x.f.rag)), text: bad.map((x) => `${x.m.name}: ${x.f.text}`).join(" · "), action: "Check the water meter and gateway" };
  } else if (fresh.every((x) => x.f.rag === "unknown") || input.alerts === undefined) {
    line = { ...base, rag: "unknown", text: "Couldn't check water", action: "Try again later" };
  } else {
    line = { ...base, rag: "green", text: `No problems flagged`, action: "No action needed" };
  }
  return withAlerts(line, alerts, "Check water supply and pressure");
}

export function siloLine(input: TodayInput): TodayLine {
  const base = { key: "silo" as const, label: "Feed silo" };
  if (input.silos === undefined) return { ...base, rag: "unknown", text: "Couldn't check silos", action: "Try again later" };
  if (!input.silos.length) return { ...base, rag: "unknown", text: "No silo sensor reading", action: "Check the silo sensor" };
  const low = input.silos.filter((s) => s.low);
  if (!low.length) return { ...base, rag: "green", text: "Not running low", action: "No action needed" };
  return { ...base, rag: "amber", text: `${low.map((s) => s.name).join(" & ")} running low`, action: "Order feed" };
}

export function dataLine(input: TodayInput): TodayLine {
  const base = { key: "data" as const, label: "Data health" };
  const power = alertsFor(input.alerts, "data");
  const bad = input.freshness.filter((f) => f.rag === "amber" || f.rag === "red");
  let line: TodayLine;
  if (bad.length) {
    const rag = worst(...bad.map((f) => f.rag));
    line = { ...base, rag, text: bad.map((f) => `${f.label} ${f.ageMinutes == null ? f.text : ageText(f.ageMinutes).replace(" ago", " old")}`).join(" · "), action: "Check power and the device that stopped" };
  } else if (input.freshness.length && input.freshness.every((f) => f.rag === "unknown")) {
    line = { ...base, rag: "unknown", text: "Couldn't check the feeds", action: "Try again later" };
  } else {
    line = { ...base, rag: "green", text: "All feeds up to date", action: "No action needed" };
  }
  if (input.alertsStale && line.rag === "green") line = { ...line, rag: "amber", text: "Alert checks are delayed", action: "Tell SenseAgri" };
  return withAlerts(line, power, "Check the shed power now");
}

export function buildToday(input: TodayInput, overrides?: unknown): TodayLine[] {
  const t = mergeThresholds(overrides);
  return [birdsLine(input, t), climateLine(input, t), waterLine(input, t), siloLine(input), dataLine(input)];
}

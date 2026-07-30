import type Anthropic from "@anthropic-ai/sdk";
import { fetchSilverDaily, isSilverMetric, type DailyRow } from "@/lib/silverSource";
import { queryInflux } from "@/lib/influxdb";
import { listHouses, type House } from "@/lib/logService";
import { listEvents } from "@/lib/eventService";
import { listVersions, type ScheduleVersion } from "@/lib/scheduleService";
import { standardHdepForWeek, standardCumulativeMortalityForWeek } from "@/lib/henStandard";
import type { FarmConfig } from "@/lib/farms";

// ─────────────────────────────────────────────────────────────────────────────
// Farm-agent tool registry.
//
// Every tool the Flock Vet assistant can call runs through the `FarmDataSource`
// seam. The v1 implementation (`LocalFarmDataSource`) reuses the app's *existing*
// farm-scoped readers — no new data-engineering logic. When v2 adds a platform-side
// gold/feature store or a RAG service, a second implementation of this interface
// swaps in and the tool/loop/UI code is untouched.
//
// SECURITY (aligns with advisory GHSA-w9fj-v7r9-j9vc): the farm is injected from the
// caller's Clerk org server-side. The model NEVER supplies farm_id / spreadsheetId.
// A model-supplied houseId is validated against the farm's own houses; metrics are
// whitelisted (SILVER_METRICS + computed); date ranges and row counts are clamped.
// No raw SQL from the model — only the existing parameter-guarded readers run.
// ─────────────────────────────────────────────────────────────────────────────

// Computed (derived) metrics, matching src/app/api/analytics/series/route.ts.
const COMPUTED = ["hdep", "cum_mortality", "breakage_rate"] as const;
type Computed = (typeof COMPUTED)[number];
const isComputed = (m: string): m is Computed => (COMPUTED as readonly string[]).includes(m);

// Metrics the model may request from history: computed + the useful silver columns.
const HISTORY_METRICS = [
  ...COMPUTED,
  "temperature", "humidity", "co2", "tvoc", "pm2_5", "pm10", "light_level",
  "eggs_total", "eggs_damaged", "avg_egg_weight", "mortality", "water_litres", "feed_kg",
] as const;

const MAX_HISTORY_DAYS = 400;
const MAX_ENV_HOURS = 168;
const MAX_EVENTS = 80;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A validation failure the model can recover from — surfaced as an is_error tool_result. */
export class ToolError extends Error {}

const round = (v: number | null | undefined, dp = 2): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function assertDate(label: string, s: unknown): string {
  if (typeof s !== "string" || !DATE_RE.test(s)) {
    throw new ToolError(`'${label}' must be a date in YYYY-MM-DD format (got ${JSON.stringify(s)}).`);
  }
  return s;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Flock week for a calendar date, from the house's placement date + age-at-placement.
function flockWeekForDate(house: House | undefined, dateIso: string): number | null {
  if (!house || !DATE_RE.test(house.startDate)) return null;
  const start = Date.parse(`${house.startDate}T00:00:00Z`);
  const on = Date.parse(dateIso.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(on)) return null;
  const days = house.startAgeDays + Math.floor((on - start) / 86_400_000);
  return Math.floor(days / 7);
}

// ── Result shapes (the seam's contract) ──────────────────────────────────────
export interface FlockSnapshot {
  farm_id: string;
  as_of: string;
  houses: { id: string; name: string; starting_hens: number }[];
  starting_hens: number;
  live_hens: number;
  cumulative_mortality: number;
  mortality_rate_pct: number | null;
  flock_age_weeks: number | null;
  last_egg_log_date: string | null;
  days_since_last_egg_log: number | null;
  latest: {
    date: string | null;
    eggs_total: number | null;
    hen_day_pct: number | null;
    avg_egg_weight_g: number | null;
    breakage_rate_pct: number | null;
  };
  data_note: string;
}

export interface HistoryResult {
  house: string;
  from: string;
  to: string;
  metrics: string[];
  rows: number;
  series: DailyRow[];
  note?: string;
}

export interface EnvironmentResult {
  farm_id: string;
  hours: number;
  current: Record<string, number | null>;
  window: Record<string, { min: number | null; mean: number | null; max: number | null }>;
  note: string;
}

export interface EventsResult {
  from: string | null;
  to: string | null;
  count: number;
  events: { date: string; time: string; type: string; title: string; details: string; house: string }[];
}

export interface ScheduleResult {
  count: number;
  schedules: { name: string; house: string; type: string; recurrence: string; times: string[]; effective_date: string; notes: string }[];
}

export interface BreedComparisonResult {
  house: string;
  from: string;
  to: string;
  breed_standard: "generic layer curve (Hy-Line-style)";
  by_week: { flock_week: number | null; actual_hdep: number | null; standard_hdep: number | null; delta: number | null }[];
  summary: { avg_actual_hdep: number | null; avg_standard_hdep: number | null; avg_delta: number | null };
  note: string;
}

// ── The seam ─────────────────────────────────────────────────────────────────
export interface FarmDataSource {
  getFlockSnapshot(): Promise<FlockSnapshot>;
  queryFlockHistory(args: { metrics: string[]; from: string; to: string; houseId?: string }): Promise<HistoryResult>;
  getRecentEnvironment(args: { hours?: number }): Promise<EnvironmentResult>;
  getEvents(args: { from?: string; to?: string }): Promise<EventsResult>;
  getSchedule(): Promise<ScheduleResult>;
  compareToBreedStandard(args: { from: string; to: string; houseId?: string }): Promise<BreedComparisonResult>;
}

// ── v1 implementation: local readers, farm-scoped ────────────────────────────
export class LocalFarmDataSource implements FarmDataSource {
  constructor(private readonly farm: FarmConfig) {}

  private get houseIds(): string[] {
    return Object.keys(this.farm.houseHens ?? {});
  }
  private get totalHens(): number {
    return Object.values(this.farm.houseHens ?? {}).reduce((a, b) => a + b, 0);
  }
  /** Resolve + validate a model-supplied houseId against the farm's own houses. */
  private resolveHouse(supplied?: string): string {
    const ids = this.houseIds;
    if (!supplied) return ids[0] ?? "house1";
    if (!ids.includes(supplied)) {
      throw new ToolError(`Unknown house '${supplied}'. This farm's houses are: ${ids.join(", ") || "(none configured)"}.`);
    }
    return supplied;
  }

  // Merged daily frame with one value per requested metric — replicates the logic in
  // src/app/api/analytics/series/route.ts so the agent sees the same numbers as the charts.
  private async computeHistory(houseId: string, metrics: string[], from: string, to: string): Promise<DailyRow[]> {
    const wanted = [...new Set(metrics)];
    const rawCols = wanted.filter((m) => !isComputed(m) && isSilverMetric(m));
    const wantHdep = wanted.includes("hdep");
    const wantCumMort = wanted.includes("cum_mortality");
    const wantBreakage = wanted.includes("breakage_rate");
    const fromIso = `${from}T00:00:00Z`;
    const toExclusiveIso = `${addDays(to, 1)}T00:00:00Z`; // include the whole 'to' day
    const byDay = new Map<string, DailyRow>();

    if (rawCols.length) {
      for (const row of await fetchSilverDaily(this.farm.farmId, houseId, rawCols, fromIso, toExclusiveIso)) {
        const day = String(row.time).slice(0, 10);
        const point: DailyRow = { time: row.time };
        for (const c of rawCols) point[c] = round(row[c] as number | null);
        byDay.set(day, point);
      }
    }

    if (wantHdep || wantCumMort || wantBreakage) {
      const total = this.totalHens;
      const hist = await fetchSilverDaily(
        this.farm.farmId, houseId, ["eggs_total", "mortality", "eggs_damaged"], "2025-01-01T00:00:00Z", toExclusiveIso,
      );
      const fromDay = from, toDay = addDays(to, 1);
      let cumMort = 0;
      for (const row of hist) {
        cumMort += num(row.mortality) ?? 0;
        const day = String(row.time).slice(0, 10);
        if (day < fromDay || day >= toDay) continue;
        const eggs = typeof row.eggs_total === "number" ? row.eggs_total : null; // null = no log → gap, not 0
        const point = byDay.get(day) ?? { time: row.time };
        if (wantHdep) {
          const live = Math.max(1, total - cumMort);
          point.hdep = total > 0 && eggs != null ? round((eggs / live) * 100, 1) : null;
        }
        if (wantCumMort) point.cum_mortality = total > 0 ? round((cumMort / total) * 100, 2) : null;
        if (wantBreakage) {
          const dmg = typeof row.eggs_damaged === "number" ? row.eggs_damaged : null;
          point.breakage_rate = eggs != null && eggs > 0 && dmg != null ? round((dmg / eggs) * 100, 2) : null;
        }
        byDay.set(day, point);
      }
    }

    return [...byDay.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  async getFlockSnapshot(): Promise<FlockSnapshot> {
    const houseId = this.resolveHouse();
    const total = this.totalHens;
    const asOf = new Date().toISOString();

    let houses: House[] = [];
    try { houses = await listHouses(this.farm.spreadsheetId); } catch { /* houses tab optional */ }
    const primaryHouse = houses.find((h) => h.id === houseId);

    // Full daily history from flock start to now — for cumulative mortality + last egg log.
    const hist = await fetchSilverDaily(
      this.farm.farmId, houseId, ["eggs_total", "mortality", "eggs_damaged", "avg_egg_weight"],
      "2025-01-01T00:00:00Z", asOf,
    );

    let cumMort = 0;
    let lastEgg: { date: string; eggs: number; weight: number | null; breakage: number | null } | null = null;
    for (const row of hist) {
      cumMort += num(row.mortality) ?? 0;
      const eggs = typeof row.eggs_total === "number" ? row.eggs_total : null;
      if (eggs != null) {
        const dmg = typeof row.eggs_damaged === "number" ? row.eggs_damaged : null;
        lastEgg = {
          date: String(row.time).slice(0, 10),
          eggs,
          weight: num(row.avg_egg_weight),
          breakage: dmg != null && eggs > 0 ? round((dmg / eggs) * 100, 2) : null,
        };
      }
    }

    const liveHens = Math.max(0, total - cumMort);
    const flockWeek = primaryHouse ? flockWeekForDate(primaryHouse, asOf) : null;
    const hdep = lastEgg && liveHens > 0 ? round((lastEgg.eggs / Math.max(1, liveHens)) * 100, 1) : null;
    const daysSince = lastEgg ? daysBetween(lastEgg.date, asOf.slice(0, 10)) : null;

    return {
      farm_id: this.farm.farmId,
      as_of: asOf,
      houses: houses.length
        ? houses.map((h) => ({ id: h.id, name: h.name, starting_hens: h.startingHens }))
        : this.houseIds.map((id) => ({ id, name: id, starting_hens: this.farm.houseHens[id] })),
      starting_hens: total,
      live_hens: liveHens,
      cumulative_mortality: cumMort,
      mortality_rate_pct: total > 0 ? round((cumMort / total) * 100, 2) : null,
      flock_age_weeks: flockWeek,
      last_egg_log_date: lastEgg?.date ?? null,
      days_since_last_egg_log: daysSince,
      latest: {
        date: lastEgg?.date ?? null,
        eggs_total: lastEgg?.eggs ?? null,
        hen_day_pct: hdep,
        avg_egg_weight_g: lastEgg?.weight ?? null,
        breakage_rate_pct: lastEgg?.breakage ?? null,
      },
      data_note:
        "Live hens = starting hens − cumulative recorded mortality. Egg/production figures come from the farm's daily log; " +
        (daysSince != null && daysSince > 3
          ? `the daily log has not been updated in ${daysSince} days, so 'latest' may be stale.`
          : "environment telemetry (temp/CO₂/etc.) is separate — use get_recent_environment for that."),
    };
  }

  async queryFlockHistory(args: { metrics: string[]; from: string; to: string; houseId?: string }): Promise<HistoryResult> {
    const houseId = this.resolveHouse(args.houseId);
    let from = assertDate("from", args.from);
    const to = assertDate("to", args.to);
    if (daysBetween(from, to) < 0) throw new ToolError("'from' must be on or before 'to'.");
    const metrics = (Array.isArray(args.metrics) ? args.metrics : [])
      .filter((m): m is string => typeof m === "string")
      .filter((m) => isComputed(m) || isSilverMetric(m))
      .slice(0, 8);
    if (!metrics.length) {
      throw new ToolError(`No valid metrics. Choose from: ${HISTORY_METRICS.join(", ")}.`);
    }

    let note: string | undefined;
    if (daysBetween(from, to) > MAX_HISTORY_DAYS) {
      from = addDays(to, -MAX_HISTORY_DAYS);
      note = `Range capped to the most recent ${MAX_HISTORY_DAYS} days (from ${from}).`;
    }

    const series = await this.computeHistory(houseId, metrics, from, to);
    return { house: houseId, from, to, metrics, rows: series.length, series, note };
  }

  async getRecentEnvironment(args: { hours?: number }): Promise<EnvironmentResult> {
    const hours = Math.min(MAX_ENV_HOURS, Math.max(1, Math.round(num(args.hours) ?? 24)));
    const cols = ["temperature", "humidity", "co2", "tvoc", "pm2_5", "pm10"] as const;

    const [latestRows, windowRows] = await Promise.all([
      queryInflux<Record<string, unknown>>(`
        SELECT ${cols.map((c) => `AVG(${c}) AS ${c}`).join(", ")}
        FROM sensors
        WHERE farm_id = '${this.farm.farmId}' AND device_type = 'AM308-1'
          AND time > now() - INTERVAL '1 hour'`),
      queryInflux<Record<string, unknown>>(`
        SELECT ${cols.map((c) => `MIN(${c}) AS ${c}_min, AVG(${c}) AS ${c}_mean, MAX(${c}) AS ${c}_max`).join(", ")}
        FROM sensors
        WHERE farm_id = '${this.farm.farmId}' AND device_type = 'AM308-1'
          AND time > now() - INTERVAL '${hours} hours'`),
    ]);

    const latest = latestRows[0] ?? {};
    const win = windowRows[0] ?? {};
    const current: Record<string, number | null> = {};
    const window: Record<string, { min: number | null; mean: number | null; max: number | null }> = {};
    for (const c of cols) {
      current[c] = round(num(latest[c]));
      window[c] = { min: round(num(win[`${c}_min`])), mean: round(num(win[`${c}_mean`])), max: round(num(win[`${c}_max`])) };
    }

    return {
      farm_id: this.farm.farmId,
      hours,
      current,
      window,
      note: "Temperatures in °C, humidity %RH, CO₂ ppm, TVOC ppb, PM in µg/m³. 'current' = last hour average; 'window' spans the requested hours. Barn air, sensor AM308.",
    };
  }

  async getEvents(args: { from?: string; to?: string }): Promise<EventsResult> {
    const from = args.from && DATE_RE.test(args.from) ? args.from : null;
    const to = args.to && DATE_RE.test(args.to) ? args.to : null;
    let events = await listEvents(this.farm.spreadsheetId);
    if (from) events = events.filter((e) => e.date >= from);
    if (to) events = events.filter((e) => e.date <= to);
    events.sort((a, b) => b.date.localeCompare(a.date));
    const capped = events.slice(0, MAX_EVENTS);
    return {
      from, to,
      count: capped.length,
      events: capped.map((e) => ({ date: e.date, time: e.time, type: e.type, title: e.title, details: e.details, house: e.house })),
    };
  }

  async getSchedule(): Promise<ScheduleResult> {
    const versions = await listVersions(this.farm.spreadsheetId);
    // Current effective version per schedule: latest effectiveDate that is on/before today.
    const today = new Date().toISOString().slice(0, 10);
    const current = new Map<string, ScheduleVersion>();
    for (const v of versions) {
      if (v.effectiveDate > today) continue;
      const prev = current.get(v.scheduleId);
      if (!prev || v.effectiveDate > prev.effectiveDate) current.set(v.scheduleId, v);
    }
    const schedules = [...current.values()].map((v) => ({
      name: v.name,
      house: v.house || "(whole farm)",
      type: v.type,
      recurrence: v.recurrence,
      times: v.times.map((t) =>
        t.end
          ? `${t.start}–${t.end}${t.runMinutes && t.everyMinutes ? ` (run ${t.runMinutes}min every ${t.everyMinutes}min)` : ""}`
          : t.start,
      ),
      effective_date: v.effectiveDate,
      notes: v.notes,
    }));
    return { count: schedules.length, schedules };
  }

  async compareToBreedStandard(args: { from: string; to: string; houseId?: string }): Promise<BreedComparisonResult> {
    const houseId = this.resolveHouse(args.houseId);
    let from = assertDate("from", args.from);
    const to = assertDate("to", args.to);
    if (daysBetween(from, to) < 0) throw new ToolError("'from' must be on or before 'to'.");
    if (daysBetween(from, to) > MAX_HISTORY_DAYS) from = addDays(to, -MAX_HISTORY_DAYS);

    let houses: House[] = [];
    try { houses = await listHouses(this.farm.spreadsheetId); } catch { /* optional */ }
    const house = houses.find((h) => h.id === houseId);

    const series = await this.computeHistory(houseId, ["hdep"], from, to);

    // Bucket daily HDEP into flock-weeks, then compare each week to the standard curve.
    const weekAgg = new Map<number, { sum: number; n: number }>();
    for (const row of series) {
      const hdep = typeof row.hdep === "number" ? row.hdep : null;
      if (hdep == null) continue;
      const wk = flockWeekForDate(house, String(row.time));
      if (wk == null) continue;
      const a = weekAgg.get(wk) ?? { sum: 0, n: 0 };
      a.sum += hdep; a.n += 1;
      weekAgg.set(wk, a);
    }

    const by_week = [...weekAgg.entries()].sort(([a], [b]) => a - b).map(([wk, a]) => {
      const actual = round(a.sum / a.n, 1);
      const std = round(standardHdepForWeek(wk), 1);
      return { flock_week: wk, actual_hdep: actual, standard_hdep: std, delta: actual != null && std != null ? round(actual - std, 1) : null };
    });

    const actuals = by_week.map((w) => w.actual_hdep).filter((v): v is number => v != null);
    const stds = by_week.map((w) => w.standard_hdep).filter((v): v is number => v != null);
    const deltas = by_week.map((w) => w.delta).filter((v): v is number => v != null);
    const avg = (xs: number[]) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length, 1) : null);

    return {
      house: houseId,
      from, to,
      breed_standard: "generic layer curve (Hy-Line-style)",
      by_week,
      summary: { avg_actual_hdep: avg(actuals), avg_standard_hdep: avg(stds), avg_delta: avg(deltas) },
      note:
        house
          ? "Flock week derived from the house's placement date. Standard is a generic commercial-layer lay curve, not breed-exact."
          : "No placement date on file for this house, so flock-week alignment may be approximate.",
    };
  }
}

// ── Tool definitions (JSON schema sent to Claude) ────────────────────────────
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_flock_snapshot",
    description:
      "Current state of the caller's flock: live hens, cumulative mortality + rate, flock age in weeks, and the latest daily-log figures (eggs, hen-day %, avg egg weight, breakage) with the date they were logged. Call this first for any 'how is my flock doing' question. Takes no arguments — the farm is fixed to the signed-in user.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "query_flock_history",
    description:
      "Daily time-series of production/mortality/environment metrics over a date range, for trend analysis. Computed metrics: hdep (hen-day egg %), cum_mortality (cumulative mortality %), breakage_rate (damaged/total eggs %). Raw metrics: temperature, humidity, co2, tvoc, pm2_5, pm10, light_level, eggs_total, eggs_damaged, avg_egg_weight, mortality, water_litres, feed_kg. Returns one row per day. Range capped to 400 days.",
    input_schema: {
      type: "object",
      properties: {
        metrics: {
          type: "array",
          items: { type: "string", enum: [...HISTORY_METRICS] },
          description: "1–8 metrics to fetch.",
        },
        from: { type: "string", description: "Start date, YYYY-MM-DD (inclusive)." },
        to: { type: "string", description: "End date, YYYY-MM-DD (inclusive)." },
      },
      required: ["metrics", "from", "to"],
    },
  },
  {
    name: "get_recent_environment",
    description:
      "Recent barn environment from live sensors (InfluxDB): last-hour average plus min/mean/max over the requested window for temperature (°C), humidity (%RH), CO₂ (ppm), TVOC (ppb), PM2.5 and PM10 (µg/m³). Use for ventilation, heat-stress and air-quality questions. Window capped to 168 hours.",
    input_schema: {
      type: "object",
      properties: { hours: { type: "number", description: "Window length in hours (1–168, default 24)." } },
      required: [],
    },
  },
  {
    name: "get_events",
    description:
      "Logged farm events (vaccinations, medications, water treatments, health observations, equipment, environmental notes) for this farm, newest first. Optionally filter by date range. Useful to correlate a production/health change with an intervention.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Optional start date, YYYY-MM-DD." },
        to: { type: "string", description: "Optional end date, YYYY-MM-DD." },
      },
      required: [],
    },
  },
  {
    name: "get_schedule",
    description:
      "The farm's current automation/husbandry schedules that are in effect today (e.g. lighting, water dosing, feed routines) — name, house, recurrence and run-times. Use to check whether routine timing could explain a change.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "compare_to_breed_standard",
    description:
      "Compare the flock's actual hen-day egg % to a generic commercial-layer lay-rate standard, week by week over a date range, with per-week deltas and an average delta. Use to judge whether production is on target for the flock's age. Range capped to 400 days.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, YYYY-MM-DD." },
        to: { type: "string", description: "End date, YYYY-MM-DD." },
      },
      required: ["from", "to"],
    },
  },
];

// ── Executor: dispatch a tool call against the farm-scoped data source ────────
type ToolInput = Record<string, unknown>;

export async function executeAgentTool(
  source: FarmDataSource, name: string, input: ToolInput,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    switch (name) {
      case "get_flock_snapshot":
        return { ok: true, data: await source.getFlockSnapshot() };
      case "query_flock_history":
        return {
          ok: true,
          data: await source.queryFlockHistory({
            metrics: (input.metrics as string[]) ?? [],
            from: String(input.from ?? ""),
            to: String(input.to ?? ""),
          }),
        };
      case "get_recent_environment":
        return { ok: true, data: await source.getRecentEnvironment({ hours: num(input.hours) ?? undefined }) };
      case "get_events":
        return {
          ok: true,
          data: await source.getEvents({
            from: typeof input.from === "string" ? input.from : undefined,
            to: typeof input.to === "string" ? input.to : undefined,
          }),
        };
      case "get_schedule":
        return { ok: true, data: await source.getSchedule() };
      case "compare_to_breed_standard":
        return {
          ok: true,
          data: await source.compareToBreedStandard({ from: String(input.from ?? ""), to: String(input.to ?? "") }),
        };
      default:
        return { ok: false, error: `Unknown tool '${name}'.` };
    }
  } catch (err) {
    if (err instanceof ToolError) return { ok: false, error: err.message };
    console.error(`agent tool '${name}' failed:`, err);
    return { ok: false, error: `Tool '${name}' failed to read the farm data. ${err instanceof Error ? err.message : ""}`.trim() };
  }
}

// Re-export for the route's system prompt (breed-standard helper is used elsewhere too).
export { standardHdepForWeek, standardCumulativeMortalityForWeek };

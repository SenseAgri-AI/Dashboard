// "This week" card (Home): the last 7 complete farm-local days against the 7 before, one line per
// measure, each with a plain up/down. Pure functions only; callers pass already-fetched data and `now`.
// User stories and rules: docs/this-week.md.

export type WeekRag = "neutral" | "amber" | "unknown";
export type WeekLine = { key: "eggs" | "deaths" | "water" | "heat"; label: string; value: string; change: string; rag: WeekRag; note?: string };

export type WeekDaily = { date: string; eggs: number; hdep: number | null; mortality: number };
export type WeekWaterDay = { date: string; meters: (number | null)[] };
export type WeekInsideDay = { date: string; maxC: number | null };

export type WeekInput = {
  now: number;
  offsetHours?: number;
  /** DailyLog rows (undefined = failed to load). */
  daily?: WeekDaily[];
  /** Daily litres per meter (undefined = failed, "loading" = still loading). */
  water?: WeekWaterDay[] | "loading";
  /** Daily inside max (°C) from 30-min averages (undefined = failed, "loading" = still loading). */
  inside?: WeekInsideDay[] | "loading";
};

export const WEEK_RULES = {
  /** Days with data needed in each week to compare. */
  minDays: 4,
  /** Change smaller than this (%) reads "about the same". */
  samePct: 3,
  /** Early-warning colour: eggs down at least this (%) on last week. */
  eggsDropPct: 5,
  /** Early-warning colour: water down at least this (%) on last week (= the Today card's 70 %). */
  waterDropPct: 30,
  /** Early-warning colour: deaths at least `deathsMin` and at least `deathsFactor` × last week. */
  deathsMin: 7,
  deathsFactor: 2,
  /** Inside "hot day" for the count. Same 32 °C as the Today card's dry-bulb backstop. */
  hotC: 32,
} as const;

const DAY = 86_400_000;
const key = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Farm-local date keys for the last 7 complete days and the 7 before (oldest first). */
export function weekWindows(now: number, offsetHours = 2): { last: string[]; prev: string[] } {
  const local = now + offsetHours * 3_600_000;
  const today0 = Date.UTC(new Date(local).getUTCFullYear(), new Date(local).getUTCMonth(), new Date(local).getUTCDate());
  const days = (from: number, n: number) => Array.from({ length: n }, (_, i) => key(today0 - (from - i) * DAY));
  return { last: days(7, 7), prev: days(14, 7) };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-ZA");
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** "↑ 6% on last week" / "↓ 12% on last week" / "about the same as last week". */
export function changeText(cur: number, prev: number): { text: string; pct: number | null } {
  if (!(prev > 0)) return { text: "", pct: null };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (Math.abs(pct) < WEEK_RULES.samePct) return { text: "about the same as last week", pct };
  return { text: `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% on last week`, pct };
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

function eggsLine(daily: WeekDaily[] | undefined, w: { last: string[]; prev: string[] }): WeekLine {
  const base = { key: "eggs" as const, label: "Eggs" };
  if (daily === undefined) return { ...base, value: "couldn't load", change: "", rag: "unknown" };
  const pick = (days: string[]) => daily.filter((r) => days.includes(r.date) && r.eggs > 0);
  const a = pick(w.last), b = pick(w.prev);
  if (a.length < WEEK_RULES.minDays) return { ...base, value: `${a.length} of 7 days logged`, change: "not enough to compare", rag: "unknown" };
  const cur = mean(a.map((r) => r.eggs));
  const hd = a.map((r) => r.hdep).filter((h): h is number => h != null);
  const value = `${fmt(cur)}/day${hd.length ? ` (lay ${Math.round(mean(hd))}%)` : ""}`;
  if (b.length < WEEK_RULES.minDays) return { ...base, value, change: "no full week before to compare", rag: "neutral" };
  const c = changeText(cur, mean(b.map((r) => r.eggs)));
  const warn = c.pct != null && c.pct <= -WEEK_RULES.eggsDropPct;
  return { ...base, value, change: c.text, rag: warn ? "amber" : "neutral",
    note: warn ? "Early warning: check the birds, feed and water" : a.length < 7 ? `${a.length} of 7 days logged` : undefined };
}

function deathsLine(daily: WeekDaily[] | undefined, w: { last: string[]; prev: string[] }): WeekLine {
  const base = { key: "deaths" as const, label: "Deaths" };
  if (daily === undefined) return { ...base, value: "couldn't load", change: "", rag: "unknown" };
  const pick = (days: string[]) => daily.filter((r) => days.includes(r.date));
  const a = pick(w.last), b = pick(w.prev);
  if (a.length < WEEK_RULES.minDays) return { ...base, value: `${a.length} of 7 days logged`, change: "not enough to compare", rag: "unknown" };
  const cur = a.reduce((s, r) => s + (r.mortality || 0), 0);
  const prev = b.length >= WEEK_RULES.minDays ? b.reduce((s, r) => s + (r.mortality || 0), 0) : null;
  const warn = prev != null && cur >= WEEK_RULES.deathsMin && cur >= WEEK_RULES.deathsFactor * Math.max(prev, 1);
  return { ...base, value: `${cur}${a.length < 7 ? ` in ${a.length} logged days` : ""}`, change: prev == null ? "no full week before to compare" : `last week ${prev}`,
    rag: warn ? "amber" : "neutral", note: warn ? "Early warning: check the birds" : undefined };
}

function waterLine(water: WeekInput["water"], w: { last: string[]; prev: string[] }): WeekLine | null {
  const base = { key: "water" as const, label: "Water" };
  if (water === "loading") return null;
  if (water === undefined) return { ...base, value: "couldn't load", change: "", rag: "unknown" };
  const width = Math.max(0, ...water.map((d) => d.meters.length));
  const active = Array.from({ length: width }, (_, j) => j).filter((j) => water.some((d) => d.meters[j] != null));
  if (!active.length) return null; // no meters on this farm
  const total = (d: WeekWaterDay) => (active.every((j) => d.meters[j] != null) ? active.reduce((s, j) => s + (d.meters[j] ?? 0), 0) : null);
  const pick = (days: string[]) => water.filter((d) => days.includes(d.date)).map(total).filter((v): v is number => v != null);
  const a = pick(w.last), b = pick(w.prev);
  if (a.length < WEEK_RULES.minDays) return { ...base, value: `${a.length} of 7 days measured`, change: "not enough to compare", rag: "unknown" };
  const cur = mean(a);
  const value = `${fmt(cur)} L/day`;
  if (b.length < WEEK_RULES.minDays) return { ...base, value, change: "no full week before to compare", rag: "neutral" };
  const c = changeText(cur, mean(b));
  const warn = c.pct != null && c.pct <= -WEEK_RULES.waterDropPct;
  return { ...base, value, change: c.text, rag: warn ? "amber" : "neutral",
    note: warn ? "Early warning: check drinkers, pressure and the birds" : a.length < 7 ? `${a.length} of 7 days measured` : undefined };
}

function heatLine(inside: WeekInput["inside"], w: { last: string[]; prev: string[] }): WeekLine | null {
  const base = { key: "heat" as const, label: "Hottest inside" };
  if (inside === "loading") return null;
  if (inside === undefined) return { ...base, value: "couldn't load", change: "", rag: "unknown" };
  const pick = (days: string[]) => inside.filter((d) => days.includes(d.date) && d.maxC != null && Number.isFinite(d.maxC)) as { date: string; maxC: number }[];
  const a = pick(w.last), b = pick(w.prev);
  if (a.length < WEEK_RULES.minDays) return { ...base, value: `${a.length} of 7 days measured`, change: "not enough to compare", rag: "unknown" };
  const top = a.reduce((x, y) => (y.maxC > x.maxC ? y : x));
  const hot = a.filter((d) => d.maxC >= WEEK_RULES.hotC).length;
  const prevTop = b.length >= WEEK_RULES.minDays ? Math.max(...b.map((d) => d.maxC)) : null;
  const prevHot = b.filter((d) => d.maxC >= WEEK_RULES.hotC).length;
  return { ...base, value: `${Math.round(top.maxC)}°C on ${dayLabel(top.date)}`,
    change: prevTop == null ? "no full week before to compare" : `last week ${Math.round(prevTop)}°C`,
    rag: "neutral", note: hot || prevHot ? `${hot} day${hot === 1 ? "" : "s"} at ${WEEK_RULES.hotC}°C+ (last week ${prevHot})` : undefined };
}

export function buildThisWeek(input: WeekInput): { lines: WeekLine[]; range: string } {
  const w = weekWindows(input.now, input.offsetHours ?? 2);
  const lines = [eggsLine(input.daily, w), deathsLine(input.daily, w), waterLine(input.water, w), heatLine(input.inside, w)]
    .filter((l): l is WeekLine => l != null);
  const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
  return { lines, range: `${short(w.last[0])} – ${short(w.last[6])}` };
}

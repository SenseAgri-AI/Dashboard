// Daily-log metrics in Analytics come from the analytics copy (silver), which can stop updating while
// the live Sheet (Home, Live dashboard) keeps going. Say so plainly instead of showing a line that just stops.

/** Daily-log metrics (raw silver columns and the ones computed from them). */
export const LOG_METRICS = [
  "eggs_total", "eggs_small", "eggs_medium", "eggs_large", "eggs_xl", "eggs_jumbo", "eggs_damaged",
  "avg_egg_weight", "mortality", "deaths", "egg_sizes", "hdep", "cum_mortality", "breakage_rate",
] as const;

export const usesDailyLog = (metrics: string[]): boolean => metrics.some((m) => (LOG_METRICS as readonly string[]).includes(m));

/** Notice when the latest daily-log day in the analytics copy is more than `maxAgeDays` before today (both YYYY-MM-DD, farm-local). */
export function logStaleNotice(lastDay: string | null | undefined, today: string, maxAgeDays = 2): string | null {
  if (!lastDay || !/^\d{4}-\d{2}-\d{2}$/.test(lastDay) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastDay}T00:00:00Z`)) / 86_400_000);
  if (age <= maxAgeDays) return null;
  const d = new Date(`${lastDay}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
  return `Daily-log figures here last updated ${d} (${age} days ago). Home shows the latest log.`;
}

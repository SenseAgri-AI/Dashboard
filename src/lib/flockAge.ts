export type FlockCycle = { startDate: string; startAgeDays: number };

const DAY_MS = 86_400_000;

export function flockAgeWeeksAt(cycle: FlockCycle | null | undefined, timestamp: number): number | null {
  if (!cycle || !/^\d{4}-\d{2}-\d{2}$/.test(cycle.startDate) || !Number.isFinite(timestamp)) return null;
  const start = Date.parse(`${cycle.startDate}T00:00:00Z`);
  if (!Number.isFinite(start)) return null;
  const ageDays = cycle.startAgeDays + Math.floor((timestamp - start) / DAY_MS);
  return Math.max(0, Math.floor(ageDays / 7));
}

export function withFlockAge(label: string, cycle: FlockCycle | null | undefined, timestamp: number, compact = false): string {
  const weeks = flockAgeWeeksAt(cycle, timestamp);
  return weeks == null ? label : `${label} · ${weeks}${compact ? "w" : " wks"}`;
}

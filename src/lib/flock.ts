// Live hens and mortality from the housed flock and the deaths logged since (docs/live-hens.md).

/** `housed` = hens housed when the daily log began (farm config houseHens); `deaths` = all logged deaths.
 *  Both null when the housed count is missing, so the UI shows "—" rather than 0. */
export function flockCounts(housed: number, deaths: number): { liveHens: number | null; mortalityPct: number | null } {
  if (!Number.isFinite(housed) || housed <= 0) return { liveHens: null, mortalityPct: null };
  const d = Number.isFinite(deaths) && deaths > 0 ? deaths : 0;
  return { liveHens: Math.max(1, housed - d), mortalityPct: (d / housed) * 100 };
}

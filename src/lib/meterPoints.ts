export type MeterPoint = { time: string; value: number; cumulative: number };

/** Sum per-meter 30-min usage into one series (meters differenced separately, so counter resets on one never leak into the other). */
export function sumMeterPoints(perMeter: MeterPoint[][]): MeterPoint[] {
  if (perMeter.length === 1) return perMeter[0];
  const byTime = new Map<string, number>();
  for (const pts of perMeter) for (const p of pts) byTime.set(p.time, (byTime.get(p.time) ?? 0) + p.value);
  let running = 0;
  return [...byTime.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, value]) => ({ time, value, cumulative: (running += value) }));
}

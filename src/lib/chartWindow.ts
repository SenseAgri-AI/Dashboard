/** Feed only visible rows to Recharts so both Y axes scale to the selected dates.
 * Keep whole rows: range bands, grouped series and standards share the window.
 */
export function chartWindow<T extends Record<string, unknown>>(data: T[], from: number, to: number): T[] {
  return data.filter(row => typeof row.t === "number" && row.t >= from && row.t <= to);
}

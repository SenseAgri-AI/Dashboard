// Data-source abstraction for analytics time-series.
//
//   recent    → InfluxDB retains only the latest ~1 month
//   long/deep → the AWS SILVER layer (S3 aligned_hourly, queried via Athena)
//
// Keeping the horizon → source decision here means the analytics UI never cares
// which store it's hitting. Silver is live (see silverSource.ts + /api/analytics/series);
// gold (derived metrics like HDEP/FCR) is still deferred.
export type Horizon = "24h" | "7d" | "30d" | "1y" | "all";

export type Source = "influx" | "silver";

// Influx keeps ~1 month, so anything beyond 30d reads from silver.
export function sourceForHorizon(h: Horizon): Source {
  return h === "1y" || h === "all" ? "silver" : "influx";
}

/** Silver reader is implemented and the app IAM user can query Athena. */
export const SILVER_AVAILABLE = true;

export function horizonAvailable(h: Horizon): boolean {
  return sourceForHorizon(h) === "influx" || SILVER_AVAILABLE;
}

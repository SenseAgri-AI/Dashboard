// Data-source abstraction for analytics time-series.
//
//   now   → InfluxDB retains only the latest ~1 month (recent horizon)
//   later → the AWS "gold" bucket (S3, cleaned full time-series) for long horizon
//
// Keeping the horizon → source decision here means extending analytics to deep
// history is a source swap, not a UI rewrite. Wiring the gold bucket is deferred.
export type Horizon = "24h" | "7d" | "30d" | "1y" | "all";

export type Source = "influx" | "gold";

export function sourceForHorizon(h: Horizon): Source {
  return h === "1y" || h === "all" ? "gold" : "influx";
}

/** Flip to true once the gold-bucket reader is implemented. */
export const GOLD_BUCKET_AVAILABLE = false;

export function horizonAvailable(h: Horizon): boolean {
  return sourceForHorizon(h) === "influx" || GOLD_BUCKET_AVAILABLE;
}

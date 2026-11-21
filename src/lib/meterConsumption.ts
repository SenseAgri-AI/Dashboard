// Shared pulse-counter math for water (and the dashboard feed sparkline).
// Each meter's cumulative `pulse_total` is differenced on its own. Counters are
// never subtracted across meters. A reset or drop is 0 litres, not negative use.

export type CumulativeRow = { bucket: string | Date; cumulative?: unknown };

export type ConsumptionPoint = { time: string; value: number; cumulative: number };

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/** Litres from one step of one meter's counter. Negative steps are 0. */
export function positivePulseLitres(previous: number, current: number, litresPerPulse: number): number {
  return Math.max(0, current - previous) * litresPerPulse;
}

/**
 * Per-bucket litres from one meter's cumulative readings, in row order.
 * The first reading is only a baseline. A null counter breaks the chain
 * (the next reading starts a new baseline). Running `cumulative` is the
 * sum of the positive litres, not the raw counter.
 */
export function cumulativeMeterPoints(rows: CumulativeRow[], unitPerPulse = 1): ConsumptionPoint[] {
  let prev: number | null = null;
  let runningTotal = 0;
  return rows.flatMap((row) => {
    const cumulative = toNum(row.cumulative);
    const value = cumulative !== null && prev !== null
      ? positivePulseLitres(prev, cumulative, unitPerPulse)
      : null;
    prev = cumulative;
    if (value === null) return [];
    runningTotal += value;
    return [{
      time: row.bucket instanceof Date ? row.bucket.toISOString() : new Date(row.bucket).toISOString(),
      value,
      cumulative: runningTotal,
    }];
  });
}

export type WaterMeterRef = { deviceId?: string | null; name?: string | null };

/**
 * Meters for the high-res water chart. Usable ids in `waterMeters` win.
 * A list that is absent, not an array, empty, or has no id accepted by `keep`
 * (after trim) falls back to `waterDeviceId` when that id is accepted too.
 * `keep` defaults to "any non-empty id"; the route passes the SQL allowlist.
 */
export function resolveWaterMeters(
  farm: { waterMeters?: WaterMeterRef[] | null; waterDeviceId?: string | null },
  keep: (deviceId: string) => boolean = () => true,
): { deviceId: string; name: string }[] {
  const configured = Array.isArray(farm.waterMeters) ? farm.waterMeters : [];
  const seen = new Set<string>();
  const meters: { deviceId: string; name: string }[] = [];
  configured.forEach((meter, index) => {
    const deviceId = String(meter?.deviceId ?? "").trim();
    if (!deviceId || !keep(deviceId) || seen.has(deviceId)) return;
    seen.add(deviceId);
    meters.push({ deviceId, name: String(meter?.name ?? "").trim() || `Meter ${index + 1}` });
  });
  if (meters.length) return meters;
  const fallback = String(farm.waterDeviceId ?? "").trim();
  return fallback && keep(fallback) ? [{ deviceId: fallback, name: "Meter 1" }] : [];
}

/** Device ids safe to interpolate into a read-only Influx SQL string. */
export function isSafeDeviceId(id: string): boolean {
  return /^[A-Za-z0-9]+$/.test(id);
}

export type MeterReadings = {
  deviceId: string;
  name: string;
  litresPerPulse: number;
  readings: { time: string; cumulative: number | null }[];
};

export type WaterBucket = {
  time: string;
  total: number;
  byMeter: { deviceId: string; name: string; litres: number | null }[];
};

/**
 * Difference each meter on its own timeline, then sum litres that land in the
 * same bucket. A meter with no reading in a bucket contributes null (not a
 * filled-in zero). An unchanged counter contributes 0. A drop contributes 0
 * and that reading becomes the next baseline, including across a gap.
 */
export function bucketWaterConsumption(meters: MeterReadings[]): WaterBucket[] {
  const perMeter = meters.map((meter) => {
    const byTime = new Map<string, number | null>();
    for (const reading of meter.readings) {
      const cumulative = toNum(reading.cumulative);
      const prev = byTime.get(reading.time);
      if (!byTime.has(reading.time)) byTime.set(reading.time, cumulative);
      else if (cumulative !== null) byTime.set(reading.time, prev == null ? cumulative : Math.max(prev, cumulative));
    }
    const ordered = [...byTime.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const litres = new Map<string, number>();
    let prev: number | null = null;
    for (const [time, cumulative] of ordered) {
      if (cumulative !== null && prev !== null) {
        litres.set(time, positivePulseLitres(prev, cumulative, meter.litresPerPulse));
      }
      prev = cumulative;
    }
    return { deviceId: meter.deviceId, name: meter.name, litres };
  });

  const times = [...new Set(perMeter.flatMap((meter) => [...meter.litres.keys()]))].sort();
  return times.map((time) => {
    const byMeter = perMeter.map((meter) => ({
      deviceId: meter.deviceId,
      name: meter.name,
      litres: meter.litres.has(time) ? meter.litres.get(time)! : null,
    }));
    const total = byMeter.reduce((sum, meter) => sum + (meter.litres ?? 0), 0);
    return { time, total, byMeter };
  });
}

const BUCKET_LABELS: Record<string, string> = {
  "15m": "15 min",
  "15 minutes": "15 min",
  "30m": "30 min",
  "30 minutes": "30 min",
  "1h": "1 h",
  "1 hour": "1 h",
  "3h": "3 h",
  "3 hours": "3 h",
  "6h": "6 h",
  "6 hours": "6 h",
};

/** Axis and series title for the high-res water chart, from the bucket that was queried. */
export function litresPerBucketLabel(resolution: string): string {
  const bucket = BUCKET_LABELS[resolution.trim().toLowerCase()] ?? resolution.trim();
  return `L per ${bucket}`;
}

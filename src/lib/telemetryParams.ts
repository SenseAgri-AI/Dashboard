// Query-parameter checks for /api/telemetry/latest and /api/telemetry/history.
// Kept free of imports so the rules can be unit-tested directly.

/** Device types the telemetry routes serve, with the fields each may be charted by. */
export const TELEMETRY_METRICS: Record<string, readonly string[]> = {
  "AM308-1": ["temperature", "humidity", "co2", "tvoc", "pressure", "pm2_5", "pm10", "light_level", "battery"],
  "EM300-1": ["battery", "pulse_total", "pulse_conv", "pulse_unit_conv"],
};

/** Columns returned by /latest per device type. */
export const LATEST_FIELDS: Record<string, string> = {
  "AM308-1": "time, temperature, humidity, co2, tvoc, pressure, pm2_5, pm10, light_level, battery",
  "EM300-1": "time, temperature, humidity, battery, pulse_total, pulse_conv, pulse_unit_conv",
};

/** LoRaWAN devEUI: 16 hex digits. */
export const DEVICE_ID_RE = /^[0-9a-f]{16}$/i;
/** InfluxDB farm_id tag value. */
export const FARM_ID_RE = /^[a-z0-9_-]+$/;

export function isValidDeviceType(t: unknown): t is string {
  return typeof t === "string" && Object.prototype.hasOwnProperty.call(TELEMETRY_METRICS, t);
}

export function isValidMetric(deviceType: string, metric: unknown): metric is string {
  return isValidDeviceType(deviceType) && typeof metric === "string" && TELEMETRY_METRICS[deviceType].includes(metric);
}

export function isValidDeviceId(id: unknown): id is string {
  return typeof id === "string" && DEVICE_ID_RE.test(id);
}

export function isValidFarmId(id: unknown): id is string {
  return typeof id === "string" && FARM_ID_RE.test(id);
}

/** The farm's own device ids from its config (lower-cased; empty/invalid entries dropped). */
export function configDeviceIds(cfg: { waterDeviceId?: unknown; feedDeviceId?: unknown }): string[] {
  return [cfg.waterDeviceId, cfg.feedDeviceId].filter(isValidDeviceId).map((s) => s.toLowerCase());
}

/** True when `deviceId` is one of the farm's devices (config ids plus ids seen under the farm's own farm_id). */
export function deviceBelongsToFarm(deviceId: string, owned: Iterable<string>): boolean {
  const want = deviceId.toLowerCase();
  for (const id of owned) if (typeof id === "string" && id.toLowerCase() === want) return true;
  return false;
}

export type TelemetryParamResult =
  | { ok: true; deviceId: string; deviceType: string; metric: string | null }
  | { ok: false; status: number; error: string };

/** Shape checks for the query params; `requireMetric` for /history. Ownership is checked separately. */
export function checkTelemetryParams(
  p: { deviceId: string | null; deviceType: string | null; metric?: string | null },
  requireMetric: boolean,
): TelemetryParamResult {
  const { deviceId, deviceType } = p;
  const metric = p.metric ?? null;
  if (!deviceId || !deviceType || (requireMetric && !metric)) {
    return { ok: false, status: 400, error: requireMetric ? "device_id, device_type, and metric required" : "device_id and device_type required" };
  }
  if (!isValidDeviceType(deviceType)) return { ok: false, status: 400, error: "unknown device_type" };
  if (!isValidDeviceId(deviceId)) return { ok: false, status: 400, error: "device_id must be 16 hex digits" };
  if (metric !== null && !isValidMetric(deviceType, metric)) return { ok: false, status: 400, error: "unknown metric for this device_type" };
  return { ok: true, deviceId: deviceId.toLowerCase(), deviceType, metric };
}

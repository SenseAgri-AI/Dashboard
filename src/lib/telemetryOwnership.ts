import { queryInflux } from "@/lib/influxdb";
import type { FarmConfig } from "@/lib/farms";
import { configDeviceIds, deviceBelongsToFarm, isValidDeviceId, isValidFarmId } from "@/lib/telemetryParams";

/** How long one farm's reporting-device list is reused before Influx is asked again. */
export const DEVICE_CACHE_TTL_MS = 10 * 60 * 1000;
const deviceCache = new Map<string, { ids: string[]; at: number }>();

/** Clears the per-farm device cache (tests). */
export function clearDeviceCache(): void {
  deviceCache.clear();
}

/** Device ids that reported under this farm's farm_id in the last 90 days, cached per farm. */
async function reportingDeviceIds(farmId: string): Promise<string[]> {
  const hit = deviceCache.get(farmId);
  if (hit && Date.now() - hit.at < DEVICE_CACHE_TTL_MS) return hit.ids;
  const rows = await queryInflux<{ device_id: string }>(`
    SELECT DISTINCT device_id
    FROM sensors
    WHERE farm_id = '${farmId}'
      AND time > now() - interval '90 days'
  `);
  const ids = rows.map((r) => String(r.device_id).toLowerCase());
  deviceCache.set(farmId, { ids, at: Date.now() });
  return ids;
}

/**
 * Whether `deviceId` (already shape-checked) belongs to the caller's farm: either it is one of the
 * farm config's devices, or it reports under the farm's own farm_id.
 */
export async function farmOwnsDevice(farm: FarmConfig, deviceId: string): Promise<boolean> {
  if (!isValidFarmId(farm.farmId) || !isValidDeviceId(deviceId)) return false;
  if (deviceBelongsToFarm(deviceId, configDeviceIds(farm))) return true;
  return deviceBelongsToFarm(deviceId, await reportingDeviceIds(farm.farmId));
}

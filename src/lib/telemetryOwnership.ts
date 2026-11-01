import { queryInflux } from "@/lib/influxdb";
import type { FarmConfig } from "@/lib/farms";
import { configDeviceIds, deviceBelongsToFarm, isValidDeviceId, isValidFarmId } from "@/lib/telemetryParams";

/**
 * Whether `deviceId` (already shape-checked) belongs to the caller's farm: either it is one of the
 * farm config's devices, or it reports under the farm's own farm_id.
 */
export async function farmOwnsDevice(farm: FarmConfig, deviceId: string, deviceType: string): Promise<boolean> {
  if (!isValidFarmId(farm.farmId) || !isValidDeviceId(deviceId)) return false;
  if (deviceBelongsToFarm(deviceId, configDeviceIds(farm))) return true;
  const rows = await queryInflux<{ device_id: string }>(`
    SELECT DISTINCT device_id
    FROM sensors
    WHERE farm_id = '${farm.farmId}'
      AND device_type = '${deviceType}'
      AND time > now() - interval '90 days'
  `);
  return deviceBelongsToFarm(deviceId, rows.map((r) => r.device_id));
}

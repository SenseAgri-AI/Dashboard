import { NextRequest, NextResponse } from "next/server";
import { queryInflux } from "@/lib/influxdb";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { checkTelemetryParams, LATEST_FIELDS } from "@/lib/telemetryParams";
import { checkDeviceOwnership } from "@/lib/telemetryOwnership";

export async function GET(req: NextRequest) {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const params = checkTelemetryParams(
    { deviceId: searchParams.get("device_id"), deviceType: searchParams.get("device_type") },
    false,
  );
  if (!params.ok) return NextResponse.json({ error: params.error }, { status: params.status });
  const { deviceId, deviceType } = params;
  const owned = await checkDeviceOwnership(farm, deviceId);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const selectFields = LATEST_FIELDS[deviceType];

  const rows = await queryInflux(`
    SELECT ${selectFields}
    FROM sensors
    WHERE farm_id = '${farm.farmId}'
      AND device_id = '${deviceId}'
      AND device_type = '${deviceType}'
    ORDER BY time DESC
    LIMIT 1
  `);

  return NextResponse.json({ reading: rows[0] ?? null });
}

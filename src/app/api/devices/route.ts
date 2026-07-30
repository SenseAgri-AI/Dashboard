import { NextResponse } from "next/server";
import { queryInflux } from "@/lib/influxdb";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  const rows = await queryInflux<{ device_id: string; device_type: string }>(`
    SELECT device_id, device_type
    FROM sensors
    WHERE farm_id = '${farm.farmId}'
    GROUP BY device_id, device_type
    ORDER BY device_type, device_id
  `);

  return NextResponse.json({ devices: rows });
}

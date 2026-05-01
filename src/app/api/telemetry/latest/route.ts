import { NextRequest, NextResponse } from "next/server";
import { queryInflux, FARM_ID } from "@/lib/influxdb";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const deviceId = searchParams.get("device_id");
  const deviceType = searchParams.get("device_type");

  if (!deviceId || !deviceType) {
    return NextResponse.json({ error: "device_id and device_type required" }, { status: 400 });
  }

  let selectFields: string;
  if (deviceType === "AM308-1") {
    selectFields = "time, temperature, humidity, co2, tvoc, pressure, pm2_5, pm10, light_level, battery";
  } else {
    selectFields = "time, temperature, humidity, battery, pulse_total, pulse_conv, pulse_unit_conv";
  }

  const rows = await queryInflux(`
    SELECT ${selectFields}
    FROM sensors
    WHERE farm_id = '${FARM_ID}'
      AND device_id = '${deviceId}'
      AND device_type = '${deviceType}'
    ORDER BY time DESC
    LIMIT 1
  `);

  return NextResponse.json({ reading: rows[0] ?? null });
}

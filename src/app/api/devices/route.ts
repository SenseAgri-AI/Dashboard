import { NextResponse } from "next/server";
import { queryInflux, FARM_ID } from "@/lib/influxdb";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await queryInflux<{ device_id: string; device_type: string }>(`
    SELECT device_id, device_type
    FROM sensors
    WHERE farm_id = '${FARM_ID}'
    GROUP BY device_id, device_type
    ORDER BY device_type, device_id
  `);

  return NextResponse.json({ devices: rows });
}

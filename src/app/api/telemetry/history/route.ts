import { NextRequest, NextResponse } from "next/server";
import { queryInflux, FARM_ID } from "@/lib/influxdb";
import { getSession } from "@/lib/session";

const RANGE_MAP: Record<string, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

// Maps resolution param to SQL interval string for date_bin
const RESOLUTION_MAP: Record<string, string> = {
  "1h":  "1 hour",
  "3h":  "3 hours",
  "6h":  "6 hours",
  "12h": "12 hours",
  "1d":  "1 day",
};

// Cumulative counter fields — use MAX-MIN delta per bucket instead of avg
const CUMULATIVE_METRICS = new Set(["pulse_total"]);

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const deviceId   = searchParams.get("device_id");
  const deviceType = searchParams.get("device_type");
  const range      = searchParams.get("range") ?? "24h";
  const metric     = searchParams.get("metric");
  const resolution = searchParams.get("resolution") ?? (range === "24h" ? "1h" : "3h");

  if (!deviceId || !deviceType || !metric) {
    return NextResponse.json({ error: "device_id, device_type, and metric required" }, { status: 400 });
  }

  const interval   = RANGE_MAP[range] ?? "24 hours";
  const bucketSize = RESOLUTION_MAP[resolution] ?? "1 hour";
  const isCumulative = CUMULATIVE_METRICS.has(metric);

  const aggregation = isCumulative
    ? `MAX(${metric}) - MIN(${metric}) as value, MAX(${metric}) as cumulative`
    : `avg(${metric}) as value`;

  // date_bin supports arbitrary intervals; origin anchors bucket boundaries to UTC midnight
  const rows = await queryInflux(`
    SELECT
      date_bin(INTERVAL '${bucketSize}', time, TIMESTAMP '1970-01-01 00:00:00') as time,
      ${aggregation}
    FROM sensors
    WHERE farm_id = '${FARM_ID}'
      AND device_id = '${deviceId}'
      AND device_type = '${deviceType}'
      AND time > now() - interval '${interval}'
    GROUP BY date_bin(INTERVAL '${bucketSize}', time, TIMESTAMP '1970-01-01 00:00:00')
    ORDER BY time ASC
  `);

  return NextResponse.json({ series: rows, isCumulative });
}

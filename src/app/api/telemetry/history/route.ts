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

// Cumulative counter fields use differences between consecutive bucket readings.
const CUMULATIVE_METRICS = new Set(["pulse_total"]);

interface CumulativeRow {
  time: string | Date;
  cumulative?: number | null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function toIso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function cumulativeDeltas(rows: CumulativeRow[], cutoff: number) {
  let prev: number | null = null;
  let runningTotal = 0;
  return rows.flatMap((row) => {
    const cumulative = toNum(row.cumulative);
    const time = toIso(row.time);
    const timeMs = new Date(time).getTime();
    const delta =
      cumulative !== null && prev !== null
        ? Math.max(0, cumulative - prev)
        : null;

    prev = cumulative;

    if (timeMs < cutoff) return [];
    const value = delta ?? 0;
    runningTotal += value;
    return [{ time, value, cumulative: runningTotal }];
  });
}

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

  if (isCumulative) {
    const cutoff = Date.now() - (range === "7d" ? 7 : range === "30d" ? 30 : 1) * 24 * 60 * 60 * 1000;
    const rows = await queryInflux<CumulativeRow>(`
      SELECT
        date_bin(INTERVAL '${bucketSize}', time, TIMESTAMP '1970-01-01 00:00:00') as time,
        MAX(${metric}) as cumulative
      FROM sensors
      WHERE farm_id = '${FARM_ID}'
        AND device_id = '${deviceId}'
        AND device_type = '${deviceType}'
        AND time > now() - interval '${interval}' - interval '${bucketSize}'
      GROUP BY date_bin(INTERVAL '${bucketSize}', time, TIMESTAMP '1970-01-01 00:00:00')
      ORDER BY time ASC
    `);

    return NextResponse.json({ series: cumulativeDeltas(rows, cutoff), isCumulative });
  }

  const aggregation = `avg(${metric}) as value`;

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

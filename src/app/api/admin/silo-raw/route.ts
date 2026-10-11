import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { requireSuperadmin, NotSuperadminError } from "@/lib/admin";
import { queryInflux } from "@/lib/influxdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Superadmin only: every silo radar reading for the caller's farm over the last 30 days, before the
// dashboard's filters, with the radar signal strength. For checking the sensors; the dashboard's own
// filtering lives in /api/silo-levels (same 10 cm and 3.6 m limits).
const DAYS = 30;
const MIN_VALID_DISTANCE_MM = 100;
const MAX_VALID_DISTANCE_MM = 3600;
const NON_PHYSICAL_DEVICE = /(test|demo|mock|simulator|virtual)/i;

interface RadarRow {
  time: Date | string | number | bigint;
  distance: number | string | bigint | null;
  device_id: string | null;
  radar_signal_rssi?: number | string | bigint | null;
}

function toNumber(value: number | string | bigint | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimeMs(value: RadarRow["time"]): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "bigint") return Number(value) / 1e6;
  if (typeof value === "number") return value > 1e14 ? value / 1e6 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  try {
    await requireSuperadmin();
  } catch (error) {
    if (error instanceof NotSuperadminError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to check access" }, { status: 500 });
  }

  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (error) {
    if (error instanceof FarmAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  try {
    const rows = await queryInflux<RadarRow>(`
      SELECT time, distance, device_id, radar_signal_rssi
      FROM sensors
      WHERE farm_id = '${farm.farmId}'
        AND device_type = 'EM411-RDL'
        AND distance IS NOT NULL
        AND time > now() - INTERVAL '${DAYS} days'
      ORDER BY time ASC
      LIMIT 20000
    `);

    const byDevice = new Map<string, { time: string; distanceMm: number; signalDb: number | null }[]>();
    for (const row of rows) {
      const deviceId = String(row.device_id ?? "").trim();
      const distanceMm = toNumber(row.distance);
      const timestamp = toTimeMs(row.time);
      if (!deviceId || NON_PHYSICAL_DEVICE.test(deviceId) || distanceMm == null || timestamp == null) continue;
      const readings = byDevice.get(deviceId) ?? [];
      readings.push({ time: new Date(timestamp).toISOString(), distanceMm: Math.round(distanceMm), signalDb: toNumber(row.radar_signal_rssi) });
      byDevice.set(deviceId, readings);
    }

    const devices = [...byDevice.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 2)
      .map(([deviceId, readings]) => ({ deviceId, readings }));

    return NextResponse.json({
      days: DAYS,
      devices,
      filters: { minMm: MIN_VALID_DISTANCE_MM, maxMm: MAX_VALID_DISTANCE_MM },
    });
  } catch (error) {
    console.error("Admin silo raw API error:", error);
    return NextResponse.json({ error: "Failed to fetch silo readings" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Radar distance is measured from the sensor to the feed surface. Distances at
// or below 1.5 m count as full usable capacity, while the drawing retains the
// physical head space above the feed.
const FULL_DISTANCE_MM = 1500;
const EMPTY_DISTANCE_MM = 3800;
const HISTORY_HOURS = 48;
const NON_PHYSICAL_DEVICE = /(test|demo|mock|simulator|virtual)/i;

interface SiloRow {
  time: Date | string | number | bigint;
  distance: number | string | bigint | null;
  device_id: string | null;
  battery?: number | string | bigint | null;
  radar_signal_rssi?: number | string | bigint | null;
}

function toNumber(value: number | string | bigint | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimeMs(value: SiloRow["time"]): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "bigint") return Number(value) / 1e6;
  if (typeof value === "number") return value > 1e14 ? value / 1e6 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fillPercent(distanceMm: number): number {
  const raw = ((EMPTY_DISTANCE_MM - distanceMm) / (EMPTY_DISTANCE_MM - FULL_DISTANCE_MM)) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}

function historyForDevice(rows: SiloRow[], deviceId: string) {
  const cutoff = Date.now() - HISTORY_HOURS * 60 * 60 * 1000;
  const byHalfHour = new Map<number, { time: string; distanceMm: number; fillPercent: number }>();

  for (const row of rows) {
    if (String(row.device_id ?? "").trim() !== deviceId) continue;
    const distanceMm = toNumber(row.distance);
    const timestamp = toTimeMs(row.time);
    if (distanceMm == null || timestamp == null || timestamp < cutoff) continue;
    const bucket = Math.floor(timestamp / (30 * 60 * 1000));
    const existing = byHalfHour.get(bucket);
    if (!existing || timestamp > new Date(existing.time).getTime()) {
      byHalfHour.set(bucket, {
        time: new Date(timestamp).toISOString(),
        distanceMm: Math.round(distanceMm),
        fillPercent: fillPercent(distanceMm),
      });
    }
  }

  return [...byHalfHour.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (error) {
    if (error instanceof FarmAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  try {
    const rows = await queryInflux<SiloRow>(`
      SELECT time, distance, device_id, battery, radar_signal_rssi
      FROM sensors
      WHERE farm_id = '${farm.farmId}'
        AND device_type = 'EM411-RDL'
        AND distance IS NOT NULL
        AND time > now() - INTERVAL '30 days'
      ORDER BY time DESC
      LIMIT 10000
    `);

    const latestByDevice = new Map<string, SiloRow>();
    for (const row of rows) {
      const deviceId = String(row.device_id ?? "").trim();
      if (!deviceId || NON_PHYSICAL_DEVICE.test(deviceId) || latestByDevice.has(deviceId)) continue;
      if (toNumber(row.distance) == null || toTimeMs(row.time) == null) continue;
      latestByDevice.set(deviceId, row);
    }

    const silos = [...latestByDevice.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 2)
      .map(([deviceId, row]) => {
        const distanceMm = toNumber(row.distance)!;
        const timestamp = toTimeMs(row.time)!;
        return {
          deviceId,
          distanceMm: Math.round(distanceMm),
          fillPercent: fillPercent(distanceMm),
          battery: toNumber(row.battery),
          signalRssi: toNumber(row.radar_signal_rssi),
          updatedAt: new Date(timestamp).toISOString(),
          history: historyForDevice(rows, deviceId),
        };
      });

    return NextResponse.json({
      silos,
      calibration: { fullDistanceMm: FULL_DISTANCE_MM, emptyDistanceMm: EMPTY_DISTANCE_MM },
      updatedAt: silos.length
        ? silos.reduce((latest, silo) => silo.updatedAt > latest ? silo.updatedAt : latest, silos[0].updatedAt)
        : null,
    });
  } catch (error) {
    console.error("Silo levels API error:", error);
    return NextResponse.json({ error: "Failed to fetch silo levels" }, { status: 500 });
  }
}

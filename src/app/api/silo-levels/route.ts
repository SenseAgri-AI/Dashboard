import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Temporary physical calibration until each silo has its own surveyed values.
// distance is the radar head space: a smaller reading means a fuller silo.
const FULL_DISTANCE_MM = 1500;
const EMPTY_DISTANCE_MM = 3800;
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
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (error) {
    if (error instanceof FarmAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
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

    // The query is newest-first, so the first valid reading for each device is its latest.
    const latestByDevice = new Map<string, SiloRow>();
    for (const row of rows) {
      const deviceId = String(row.device_id ?? "").trim();
      if (!deviceId || latestByDevice.has(deviceId) || toNumber(row.distance) == null || toTimeMs(row.time) == null) continue;
      latestByDevice.set(deviceId, row);
    }

    const silos = [...latestByDevice.entries()]
      .filter(([deviceId]) => !NON_PHYSICAL_DEVICE.test(deviceId))
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
        };
      })
      .sort((a, b) => a.deviceId.localeCompare(b.deviceId))
      .slice(0, 2);

    return NextResponse.json({
      silos,
      calibration: { fullDistanceMm: FULL_DISTANCE_MM, emptyDistanceMm: EMPTY_DISTANCE_MM },
      updatedAt: silos.length ? silos.reduce((latest, silo) => silo.updatedAt > latest ? silo.updatedAt : latest, silos[0].updatedAt) : null,
    });
  } catch (error) {
    console.error("Silo levels API error:", error);
    return NextResponse.json({ error: "Failed to fetch silo levels" }, { status: 500 });
  }
}

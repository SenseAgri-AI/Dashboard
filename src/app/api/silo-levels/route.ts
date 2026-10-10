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
// Readings outside this band are treated as radar faults and dropped from both the current
// level and the history: the silo shows its latest valid reading. A signal of exactly 0 dB is the
// sensor's "no echo" placeholder (it arrives with a -3 mm distance), so those are dropped too.
const MIN_VALID_DISTANCE_MM = 100;
const MAX_VALID_DISTANCE_MM = 3500;
// Smoothing: one value per SAST day, the median of that day's valid readings (12 hours either side
// of midday); the gauges use the median of the last 24 hours of valid readings.
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 30;
const HISTORY_HOURS = HISTORY_DAYS * 24;
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

function validDistance(row: SiloRow): number | null {
  const distanceMm = toNumber(row.distance);
  if (distanceMm == null || distanceMm < MIN_VALID_DISTANCE_MM || distanceMm > MAX_VALID_DISTANCE_MM) return null;
  if (toNumber(row.radar_signal_rssi) === 0) return null; // no-echo placeholder
  return distanceMm;
}

function fillPercent(distanceMm: number): number {
  const raw = ((EMPTY_DISTANCE_MM - distanceMm) / (EMPTY_DISTANCE_MM - FULL_DISTANCE_MM)) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function historyForDevice(rows: SiloRow[], deviceId: string) {
  const cutoff = Date.now() - HISTORY_HOURS * 60 * 60 * 1000;
  const byHalfHour = new Map<number, { time: string; distanceMm: number; fillPercent: number }>();

  for (const row of rows) {
    if (String(row.device_id ?? "").trim() !== deviceId) continue;
    const distanceMm = validDistance(row);
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

function dailyMedians(points: { time: string; distanceMm: number }[]) {
  const byDay = new Map<string, number[]>();
  for (const point of points) {
    const day = new Date(Date.parse(point.time) + SAST_OFFSET_MS).toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), point.distanceMm]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => {
    const medianMm = median(values);
    return { date, medianMm: Math.round(medianMm), medianFillPercent: fillPercent(medianMm), readings: values.length };
  });
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
        AND time > now() - INTERVAL '${HISTORY_DAYS} days'
      ORDER BY time DESC
      LIMIT 10000
    `);

    const latestByDevice = new Map<string, SiloRow>();
    for (const row of rows) {
      const deviceId = String(row.device_id ?? "").trim();
      if (!deviceId || NON_PHYSICAL_DEVICE.test(deviceId) || latestByDevice.has(deviceId)) continue;
      if (validDistance(row) == null || toTimeMs(row.time) == null) continue;
      latestByDevice.set(deviceId, row);
    }

    const silos = [...latestByDevice.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 2)
      .map(([deviceId, row]) => {
        const distanceMm = toNumber(row.distance)!;
        const timestamp = toTimeMs(row.time)!;
        const history = historyForDevice(rows, deviceId);
        const latestMs = history.length ? Date.parse(history[history.length - 1].time) : timestamp;
        const lastDay = history.filter((point) => latestMs - Date.parse(point.time) < DAY_MS).map((point) => point.distanceMm);
        const medianMm = lastDay.length ? median(lastDay) : distanceMm;
        return {
          deviceId,
          distanceMm: Math.round(distanceMm),
          fillPercent: fillPercent(distanceMm),
          medianMm: Math.round(medianMm),
          medianFillPercent: fillPercent(medianMm),
          medianReadings: lastDay.length,
          battery: toNumber(row.battery),
          signalRssi: toNumber(row.radar_signal_rssi),
          updatedAt: new Date(timestamp).toISOString(),
          history,
          daily: dailyMedians(history),
        };
      });

    return NextResponse.json({
      silos,
      calibration: { fullDistanceMm: FULL_DISTANCE_MM, emptyDistanceMm: EMPTY_DISTANCE_MM },
      validRangeMm: { min: MIN_VALID_DISTANCE_MM, max: MAX_VALID_DISTANCE_MM },
      updatedAt: silos.length
        ? silos.reduce((latest, silo) => silo.updatedAt > latest ? silo.updatedAt : latest, silos[0].updatedAt)
        : null,
    });
  } catch (error) {
    console.error("Silo levels API error:", error);
    return NextResponse.json({ error: "Failed to fetch silo levels" }, { status: 500 });
  }
}

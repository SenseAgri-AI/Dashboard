import { NextResponse } from "next/server";
import { queryInflux, FARM_ID } from "@/lib/influxdb";
import { getSession } from "@/lib/session";
import {
  tempStatus,
  humidityStatus,
  co2Status,
  computeHealth,
  healthLabel,
  healthWord,
  vpd,
} from "@/lib/thresholds";

interface SparkRow {
  bucket: string | Date;
  temperature?: number;
  humidity?: number;
  co2?: number;
  tvoc?: number;
}

interface MeterRow {
  bucket: string | Date;
  cumulative?: number;
}

const WATER_DEVICE_ID = "24e124136f451854";
const FEED_DEVICE_ID = "24e124136f452271";
const WATER_LITRES_PER_PULSE = 10;
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

function toPoint(bucket: string | Date, value: unknown): { time: string; value: number } | null {
  const n = toNum(value);
  if (n === null) return null;
  return {
    time: bucket instanceof Date ? bucket.toISOString() : new Date(bucket).toISOString(),
    value: n,
  };
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function stats(vals: number[]): { mean: number; std: number } {
  if (vals.length === 0) return { mean: 0, std: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { mean, std: Math.sqrt(variance) };
}

function startOfSastDayUtc(): number {
  const nowSast = new Date(Date.now() + SAST_OFFSET_MS);
  const dayKey = nowSast.toISOString().slice(0, 10);
  return new Date(`${dayKey}T00:00:00+02:00`).getTime();
}

function cumulativeMeterPoints(rows: MeterRow[], unitPerPulse = 1): { time: string; value: number; cumulative: number }[] {
  let prev: number | null = null;
  let runningTotal = 0;
  return rows.flatMap((row) => {
    const cumulative = toNum(row.cumulative);
    const value =
      cumulative !== null && prev !== null
        ? Math.max(0, cumulative - prev) * unitPerPulse
        : null;
    prev = cumulative;
    if (value === null) return [];
    runningTotal += value;
    return [
      {
        time: row.bucket instanceof Date ? row.bucket.toISOString() : new Date(row.bucket).toISOString(),
        value,
        cumulative: runningTotal,
      },
    ];
  });
}

function rebaseCumulative(points: { time: string; value: number; cumulative: number }[]) {
  let runningTotal = 0;
  return points.map((pt) => {
    runningTotal += pt.value;
    return { ...pt, cumulative: runningTotal };
  });
}

function isNightSast(): boolean {
  const hour = new Date(Date.now() + SAST_OFFSET_MS).getUTCHours();
  return hour >= 20 || hour < 6;
}

function sustainedBelowThreshold(
  sparkline: { time: string; value: number }[],
  thresholdC: number,
  durationHours: number
): boolean {
  const cutoff = Date.now() - durationHours * 60 * 60 * 1000;
  const recent = sparkline.filter((pt) => new Date(pt.time).getTime() >= cutoff);
  // Need at least durationHours*2 points (30-min buckets) to make the call
  if (recent.length < durationHours * 2) return false;
  return recent.every((pt) => pt.value < thresholdC);
}

function tempAlertMessage(
  val: number | null,
  sparkline: { time: string; value: number }[]
): { status: "normal" | "warning" | "danger"; message: string } {
  if (val === null) return { status: "normal", message: "No data from sensor." };
  const v = Math.round(val * 10) / 10;

  // Heat stress thresholds apply day and night
  if (val > 30) return { status: "danger", message: `Critical. ${v}°C — heat stress threshold exceeded. Check cooling immediately.` };
  if (val > 26) return { status: "warning", message: `Elevated. ${v}°C approaching heat stress threshold — monitor closely.` };

  const night = isNightSast();

  if (night) {
    if (val < 10) return { status: "danger", message: `Cold night. ${v}°C — below 10°C threshold. Birds diverting energy to thermoregulation. Expect increased feed intake.` };
    if (val < 14) return { status: "warning", message: `Cool night. ${v}°C — below optimal. Monitor feed consumption tomorrow.` };
    return { status: "normal", message: `${v}°C — within acceptable night range.` };
  } else {
    if (val < 14 && sustainedBelowThreshold(sparkline, 14, 3)) {
      return { status: "warning", message: `Sustained cold. ${v}°C for 3+ hours — birds burning extra energy on thermoregulation. Expect higher feed intake today.` };
    }
    if (val < 14) return { status: "warning", message: `Low. ${v}°C — below optimal daytime range. Monitor closely.` };
    return { status: "normal", message: `Within range. ${v}°C — no action required.` };
  }
}

function alertMessage(
  metric: "humidity" | "co2",
  val: number | null
): string {
  if (val === null) return "No data from sensor.";
  const v = Math.round(val * 10) / 10;
  if (metric === "humidity") {
    const status = val < 40 || val > 85 ? "danger" : val < 50 || val > 75 ? "warning" : "normal";
    if (status === "danger") return `Out of range. ${v}% RH — check ventilation and water systems.`;
    if (status === "warning") return `${val < 50 ? "Low" : "High"}. ${v}% RH — outside optimal 50–70% band.`;
    return `Within range. ${v}% RH — no action required.`;
  }
  if (metric === "co2") {
    if (v > 1400) return `Insufficient. CO₂ ${Math.round(v)}ppm — check fans immediately.`;
    if (v > 800) return `Elevated. CO₂ ${Math.round(v)}ppm — increase ventilation.`;
    return `Good. CO₂ ${Math.round(v)}ppm — ventilation sufficient.`;
  }
  return "";
}

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Latest AM308 reading
    const [latestRows, sparkRows, waterSparkRows, feedSparkRows] = await Promise.all([
      queryInflux<Record<string, unknown>>(`
        SELECT
          AVG(temperature) AS temperature,
          AVG(humidity)    AS humidity,
          AVG(co2)         AS co2,
          AVG(tvoc)        AS tvoc,
          AVG(pressure)    AS pressure
        FROM sensors
        WHERE farm_id = '${FARM_ID}'
          AND device_type = 'AM308-1'
          AND time > now() - INTERVAL '1 hour'
      `),
      queryInflux<SparkRow>(`
        SELECT
          date_bin(INTERVAL '30 minutes', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
          AVG(temperature) AS temperature,
          AVG(humidity)    AS humidity,
          AVG(co2)         AS co2,
          AVG(tvoc)        AS tvoc
        FROM sensors
        WHERE farm_id = '${FARM_ID}'
          AND device_type = 'AM308-1'
          AND time > now() - INTERVAL '24 hours'
        GROUP BY bucket
        ORDER BY bucket ASC
      `),
      queryInflux<MeterRow>(`
        SELECT
          date_bin(INTERVAL '30 minutes', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
          MAX(pulse_total) AS cumulative
        FROM sensors
        WHERE farm_id = '${FARM_ID}'
          AND device_id = '${WATER_DEVICE_ID}'
          AND time > now() - INTERVAL '25 hours'
        GROUP BY bucket
        ORDER BY bucket ASC
      `),
      queryInflux<MeterRow>(`
        SELECT
          date_bin(INTERVAL '30 minutes', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
          MAX(pulse_total) AS cumulative
        FROM sensors
        WHERE farm_id = '${FARM_ID}'
          AND device_id = '${FEED_DEVICE_ID}'
          AND time > now() - INTERVAL '25 hours'
        GROUP BY bucket
        ORDER BY bucket ASC
      `),
    ]);

    const latest = latestRows[0] ?? {};
    const temp = toNum(latest.temperature);
    const humidity = toNum(latest.humidity);
    const co2 = toNum(latest.co2);
    const tvocCurrent = toNum(latest.tvoc);

    const tempSpark = sparkRows.map((r) => toPoint(r.bucket, r.temperature)).filter((v): v is { time: string; value: number } => v !== null);
    const humiditySpark = sparkRows.map((r) => toPoint(r.bucket, r.humidity)).filter((v): v is { time: string; value: number } => v !== null);
    const co2Spark = sparkRows.map((r) => toPoint(r.bucket, r.co2)).filter((v): v is { time: string; value: number } => v !== null);
    const tvocSpark = sparkRows.map((r) => toPoint(r.bucket, r.tvoc)).filter((v): v is { time: string; value: number } => v !== null);
    const tvocVals = tvocSpark.map((pt) => pt.value);

    // Consumption is derived from consecutive cumulative meter readings.
    const allWaterPoints = cumulativeMeterPoints(waterSparkRows, WATER_LITRES_PER_PULSE);
    const cutoff3h = Date.now() - 3 * 60 * 60 * 1000;
    const waterLast3h = allWaterPoints
      .filter((pt) => new Date(pt.time).getTime() >= cutoff3h)
      .reduce((sum, pt) => sum + pt.value, 0);
    const todayStart = startOfSastDayUtc();
    const waterToday = allWaterPoints
      .filter((pt) => new Date(pt.time).getTime() >= todayStart)
      .reduce((sum, pt) => sum + pt.value, 0);
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const waterSpark = rebaseCumulative(
      allWaterPoints.filter((pt) => new Date(pt.time).getTime() >= cutoff24h)
    );
    const waterVals = waterSpark.map((pt) => pt.value);
    const waterCurrent = waterSpark.length > 0 ? waterLast3h : null;
    const feedSpark = rebaseCumulative(
      cumulativeMeterPoints(feedSparkRows).filter((pt) => new Date(pt.time).getTime() >= cutoff24h)
    );

    const tvocStats = stats(tvocVals);
    const waterStats = stats(waterVals);

    const ts = tempStatus(temp);
    const hs = humidityStatus(humidity);
    const cs = co2Status(co2);
    const health = computeHealth(temp, humidity, co2);
    const statusLabel = healthLabel(health);

    const vaporPressure = temp !== null && humidity !== null ? vpd(temp, humidity) : null;

    return NextResponse.json({
      env: {
        temperature: { current: temp, status: ts, sparkline: tempSpark },
        humidity: { current: humidity, status: hs, sparkline: humiditySpark },
        co2: { current: co2, status: cs, sparkline: co2Spark },
        tvoc: {
          current: tvocCurrent,
          sparkline: tvocSpark,
          mean: tvocStats.mean,
          std: tvocStats.std,
        },
        water: {
          current: waterCurrent,
          today: waterSpark.length > 0 ? waterToday : null,
          sparkline: waterSpark,
          mean: waterStats.mean,
          std: waterStats.std,
        },
      },
      metrics: {
        vapour_pressure: vaporPressure,
      },
      health,
      healthWord: healthWord(health),
      healthLabel: statusLabel,
      alerts: [
        {
          metric: "Temperature",
          ...tempAlertMessage(temp, tempSpark),
          updatedAt: tempSpark.at(-1)?.time ?? null,
        },
        {
          metric: "Ventilation",
          status: cs,
          message: alertMessage("co2", co2),
          updatedAt: co2Spark.at(-1)?.time ?? null,
        },
        {
          metric: "Humidity",
          status: hs,
          message: alertMessage("humidity", humidity),
          updatedAt: humiditySpark.at(-1)?.time ?? null,
        },
        {
          metric: "Hen-Day %",
          status: "neutral" as const,
          message: "Production data not yet integrated — connect egg count feed.",
          updatedAt: null,
        },
        {
          metric: "Water consumption",
          status: "neutral" as const,
          message:
            waterCurrent !== null
              ? `Last 3 hours ${Math.round(waterCurrent).toLocaleString()} litres. Today ${Math.round(waterToday).toLocaleString()} litres.`
              : "No water meter data available.",
          updatedAt: waterSpark.at(-1)?.time ?? null,
        },
      ],
      operational: {
        feed: {
          sparkline: feedSpark,
        },
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Dashboard summary error:", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

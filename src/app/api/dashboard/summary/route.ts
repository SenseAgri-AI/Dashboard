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

interface WaterRow {
  bucket: string | Date;
  cumulative?: number;
}

const WATER_DEVICE_ID = "24e124136f451854";
const WATER_LITRES_PER_PULSE = 10;

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

function cumulativeWaterPoints(rows: WaterRow[]): { time: string; value: number; cumulative: number }[] {
  let prev: number | null = null;
  let runningTotal = 0;
  return rows.flatMap((row) => {
    const cumulative = toNum(row.cumulative);
    const value =
      cumulative !== null && prev !== null
        ? Math.max(0, cumulative - prev) * WATER_LITRES_PER_PULSE
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

function dailyWaterPoints(rows: WaterRow[]): { date: string; litres: number }[] {
  let prev: number | null = null;
  return rows.flatMap((row) => {
    const cumulative = toNum(row.cumulative);
    const litres =
      cumulative !== null && prev !== null
        ? Math.max(0, cumulative - prev) * WATER_LITRES_PER_PULSE
        : null;
    prev = cumulative;
    if (litres === null) return [];
    return [
      {
        date: row.bucket instanceof Date ? row.bucket.toISOString() : new Date(row.bucket).toISOString(),
        litres,
      },
    ];
  });
}

function alertMessage(
  metric: "temperature" | "humidity" | "co2",
  status: "normal" | "warning" | "danger",
  val: number | null
): string {
  if (val === null) return "No data from sensor.";
  const v = Math.round(val * 10) / 10;
  if (metric === "temperature") {
    if (status === "danger") {
      return val > 26
        ? `Critical. ${v}°C — heat stress threshold exceeded. Check cooling immediately.`
        : `Critical. ${v}°C — cold stress risk. Check heating immediately.`;
    }
    if (status === "warning") {
      return val > 26
        ? `Elevated. ${v}°C approaching heat stress threshold — monitor closely.`
        : `Low. ${v}°C below optimal range — check heating.`;
    }
    return `Within range. ${v}°C — no action required.`;
  }
  if (metric === "humidity") {
    if (status === "danger") return `Out of range. ${v}% RH — check ventilation and water systems.`;
    if (status === "warning") {
      const dir = val < 50 ? "Low" : "High";
      return `${dir}. ${v}% RH — outside optimal 50–70% band.`;
    }
    return `Within range. ${v}% RH — no action required.`;
  }
  if (metric === "co2") {
    if (status === "danger") return `Insufficient. CO₂ ${Math.round(v)}ppm — check fans immediately.`;
    if (status === "warning") return `Elevated. CO₂ ${Math.round(v)}ppm — increase ventilation.`;
    return `Good. CO₂ ${Math.round(v)}ppm — ventilation sufficient.`;
  }
  return "";
}

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Latest AM308 reading
    const [latestRows, sparkRows, waterLastHourRows, waterSparkRows, waterDailyRows] = await Promise.all([
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
      queryInflux<WaterRow>(`
        SELECT
          date_bin(INTERVAL '30 minutes', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
          MAX(pulse_total) AS cumulative
        FROM sensors
        WHERE farm_id = '${FARM_ID}'
          AND device_id = '${WATER_DEVICE_ID}'
          AND time > now() - INTERVAL '1 hour'
        GROUP BY bucket
        ORDER BY bucket ASC
      `),
      queryInflux<WaterRow>(`
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
      queryInflux<WaterRow>(`
        SELECT
          date_bin(INTERVAL '1 day', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
          MAX(pulse_total) AS cumulative
        FROM sensors
        WHERE farm_id = '${FARM_ID}'
          AND device_id = '${WATER_DEVICE_ID}'
          AND time > now() - INTERVAL '9 days'
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
    const waterLastHour = cumulativeWaterPoints(waterLastHourRows);
    const waterLastHourDelta = waterLastHour.length > 0 ? waterLastHour[waterLastHour.length - 1].value : null;
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const waterSpark = cumulativeWaterPoints(waterSparkRows).filter(
      (pt) => new Date(pt.time).getTime() >= cutoff24h
    );
    const waterVals = waterSpark.map((pt) => pt.value);
    const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const waterDaily = dailyWaterPoints(waterDailyRows).filter(
      (pt) => new Date(pt.date).getTime() >= cutoff7d
    );
    // Fall back to most recent sparkline point if last-hour query has no data
    const waterCurrent = waterLastHourDelta ?? (waterSpark.length > 0 ? waterSpark[waterSpark.length - 1].value : null);

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
          sparkline: waterSpark,
          daily: waterDaily,
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
          status: ts,
          message: alertMessage("temperature", ts, temp),
        },
        {
          metric: "Ventilation",
          status: cs,
          message: alertMessage("co2", cs, co2),
        },
        {
          metric: "Humidity",
          status: hs,
          message: alertMessage("humidity", hs, humidity),
        },
        {
          metric: "Hen-Day %",
          status: "neutral" as const,
          message: "Production data not yet integrated — connect egg count feed.",
        },
        {
          metric: "Water consumption",
          status: "neutral" as const,
          message:
            waterCurrent !== null
              ? `Latest 30 min ${Math.round(waterCurrent).toLocaleString()} litres. 1 pulse = ${WATER_LITRES_PER_PULSE} litres.`
              : "No water meter data available.",
        },
      ],
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Dashboard summary error:", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

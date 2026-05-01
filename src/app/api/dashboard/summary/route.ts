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
  delta?: number;
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
    const [latestRows, sparkRows, waterLatestRows, waterSparkRows] = await Promise.all([
      queryInflux<Record<string, unknown>>(`
        SELECT temperature, humidity, co2, tvoc, pressure
        FROM sensors
        WHERE farm_id = '${FARM_ID}' AND device_type = 'AM308-1'
        ORDER BY time DESC LIMIT 1
      `),
      queryInflux<SparkRow>(`
        SELECT
          date_bin(INTERVAL '1 hour', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
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
      queryInflux<Record<string, unknown>>(`
        SELECT pulse_total
        FROM sensors
        WHERE farm_id = '${FARM_ID}' AND device_id = '452271'
        ORDER BY time DESC LIMIT 1
      `),
      queryInflux<WaterRow>(`
        SELECT
          date_bin(INTERVAL '1 hour', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
          MAX(pulse_total) - MIN(pulse_total) AS delta
        FROM sensors
        WHERE farm_id = '${FARM_ID}'
          AND device_id = '452271'
          AND time > now() - INTERVAL '24 hours'
        GROUP BY bucket
        ORDER BY bucket ASC
      `),
    ]);

    const latest = latestRows[0] ?? {};
    const temp = toNum(latest.temperature);
    const humidity = toNum(latest.humidity);
    const co2 = toNum(latest.co2);
    const tvocCurrent = toNum(latest.tvoc);

    const tempSpark = sparkRows.map((r) => toNum(r.temperature)).filter((v): v is number => v !== null);
    const humiditySpark = sparkRows.map((r) => toNum(r.humidity)).filter((v): v is number => v !== null);
    const co2Spark = sparkRows.map((r) => toNum(r.co2)).filter((v): v is number => v !== null);
    const tvocSpark = sparkRows.map((r) => toNum(r.tvoc)).filter((v): v is number => v !== null);

    const waterCurrent = toNum((waterLatestRows[0] ?? {}).pulse_total);
    const waterSpark = waterSparkRows.map((r) => toNum(r.delta)).filter((v): v is number => v !== null);

    const tvocStats = stats(tvocSpark);
    const waterStats = stats(waterSpark);

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
              ? `Latest reading ${Math.round(waterCurrent).toLocaleString()} pulses. No significant deviation detected.`
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

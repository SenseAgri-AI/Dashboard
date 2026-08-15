import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";
import { listEntries } from "@/lib/logService";
import { fetchAnomalies } from "@/lib/acousticSource";
import { powerOutageAlert, logsOverdueAlert, nightDisturbanceAlert, type Alert, type NoisePoint } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The new alert board (see alerts-spec.md). Evaluates the alert rules against live farm data and
// returns the ones currently firing. Farm-scoped. v1 = power / connectivity only; more rules land here.

// Latest data-point time (ms epoch) for a measurement, or null if nothing in the lookback window.
async function lastSeenMs(measurement: "sensors" | "audio_noise", farmId: string): Promise<number | null> {
  const rows = await queryInflux<{ time: unknown }>(`
    SELECT time FROM ${measurement}
    WHERE farm_id = '${farmId}' AND time > now() - interval '24 hours'
    ORDER BY time DESC
    LIMIT 1
  `);
  const t = rows[0]?.time;
  if (t == null) return null;
  const ms = t instanceof Date ? t.getTime()
    : typeof t === "bigint" ? Number(t) / 1e6         // ns → ms
    : typeof t === "number" ? (t > 1e14 ? t / 1e6 : t)
    : new Date(String(t)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Normalise a sheet date (ISO or DD/MM/YYYY) to YYYY-MM-DD, mirroring the production route.
function normDate(raw: string): string | null {
  if (!raw) return null;
  const parts = raw.trim().split(/[\/\-]/);
  if (parts.length !== 3) return null;
  let y: string, m: string, d: string;
  if (parts[0].length === 4) [y, m, d] = parts;
  else [d, m, y] = parts;
  if (!y || !m || !d) return null;
  const key = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return Number.isNaN(new Date(key).getTime()) ? null : key;
}

// Latest daily-log date (YYYY-MM-DD) from the sheet, or null if there are no entries.
async function lastLogDate(spreadsheetId: string): Promise<string | null> {
  const entries = await listEntries(spreadsheetId);
  const keys = entries.map((e) => normDate(e.date)).filter((k): k is string => k != null);
  return keys.length ? keys.reduce((a, b) => (a > b ? a : b)) : null;
}

function toMs(t: unknown): number {
  if (t == null) return NaN;
  return t instanceof Date ? t.getTime()
    : typeof t === "bigint" ? Number(t) / 1e6
    : typeof t === "number" ? (t > 1e14 ? t / 1e6 : t)
    : new Date(String(t)).getTime();
}

// Recent mean-noise series for the night-disturbance rule — last ~18 h covers last night.
async function nightNoise(farmId: string): Promise<NoisePoint[]> {
  const rows = await queryInflux<Record<string, unknown>>(`
    SELECT time, noise_db_mean FROM audio_noise
    WHERE farm_id = '${farmId}' AND time > now() - interval '18 hours'
    ORDER BY time ASC`);
  return rows.map((r) => {
    const n = Number(r.noise_db_mean);
    return { t: toMs(r.time), mean: Number.isFinite(n) ? n : null };
  });
}

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  // Each source is fetched independently so one failing never blocks — or false-fires — another rule.
  const [climateR, acousticR, logR, nightR] = await Promise.allSettled([
    lastSeenMs("sensors", farm.farmId),
    lastSeenMs("audio_noise", farm.farmId),
    lastLogDate(farm.spreadsheetId),
    nightNoise(farm.farmId),
  ]);
  const now = Date.now();
  const alerts: Alert[] = [];

  // Power / connectivity — only when BOTH last-seen queries succeeded (a query error must not
  // masquerade as a device being down).
  if (climateR.status === "fulfilled" && acousticR.status === "fulfilled") {
    const outage = powerOutageAlert({ climateLastSeenMs: climateR.value, acousticLastSeenMs: acousticR.value, now });
    if (outage) alerts.push(outage);
  } else {
    console.error("alerts: last-seen query failed — skipping power rule");
  }

  // Daily-log overdue
  if (logR.status === "fulfilled") {
    const logs = logsOverdueAlert({ lastLogDate: logR.value, now });
    if (logs) alerts.push(logs);
  } else {
    console.error("alerts: last-log read failed — skipping log rule", logR.reason);
  }

  // Night disturbance (welfare) — sustained rise in the mean flock-noise level overnight.
  if (nightR.status === "fulfilled") {
    const night = nightDisturbanceAlert({ series: nightR.value, now });
    if (night) {
      // Only when it fires: attach the nearest saved anomaly clip so the farmer can listen.
      try {
        const houseId = Object.keys(farm.houseHens ?? {})[0] || "house1";
        const anoms = (await fetchAnomalies(farm.farmId, houseId, now - 18 * 3_600_000, now)).filter((a) => a.clipKey);
        if (anoms.length) {
          const nearest = anoms.reduce((best, a) =>
            Math.abs(new Date(a.time).getTime() - night.eventStartMs) < Math.abs(new Date(best.time).getTime() - night.eventStartMs) ? a : best);
          night.clipKey = nearest.clipKey;
        }
      } catch (e) {
        console.error("alerts: night-clip lookup failed", e);
      }
      alerts.push(night);
    }
  } else {
    console.error("alerts: night-noise query failed — skipping night rule", nightR.reason);
  }

  return NextResponse.json({ alerts, updatedAt: new Date(now).toISOString() });
}

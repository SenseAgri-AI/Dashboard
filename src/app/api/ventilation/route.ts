import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError, validLocation } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";
import { mergeVentThresholds, outsideForPage, parseOpenMeteo } from "@/lib/ventilation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Ventilation page data: inside climate (30-min averages, last 30 days, read-only) plus the outside
// forecast from Open-Meteo (free, no key) for the farm's configured location. Either part may be
// missing; the page says which. Sunrise/sunset cover the same 30 days so the month chart can split
// day and night. Suggestions still use only the recent window.

function toMs(t: unknown): number | null {
  if (t == null) return null;
  const ms = t instanceof Date ? t.getTime()
    : typeof t === "bigint" ? Number(t) / 1e6
    : typeof t === "number" ? (t > 1e14 ? t / 1e6 : t)
    : new Date(String(t)).getTime();
  return Number.isFinite(ms) ? ms : null;
}
const num = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);


const FORECAST_TIMEOUT_MS = 10_000;
const PRIVATE = { headers: { "Cache-Control": "private, no-store" } };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, ...PRIVATE });
}

async function forecast(loc: { lat: number; lon: number }) {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${loc.lat}&longitude=${loc.lon}`
    + "&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,cloud_cover,weather_code,wind_speed_10m,wind_gusts_10m"
    + "&daily=sunrise,sunset&past_days=30&forecast_days=4&timezone=GMT&timeformat=unixtime";
  // Story: if the weather service hangs, I still want the inside readings, not a page that spins forever.
  const res = await fetch(url, { next: { revalidate: 1800 }, signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return parseOpenMeteo(await res.json());
}

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return json({ error: err.message }, 403);
    return json({ error: "Failed to resolve farm" }, 500);
  }
  const location = validLocation(farm.location);
  const [insideRes, outsideRes] = await Promise.allSettled([
    queryInflux<Record<string, unknown>>(`
      SELECT date_bin(INTERVAL '30 minutes', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
        AVG(temperature) AS temperature, AVG(humidity) AS humidity, AVG(co2) AS co2, MAX(temperature) AS temperature_max
      FROM sensors
      WHERE farm_id = '${String(farm.farmId).replace(/'/g, "''")}' AND device_type = 'AM308-1' AND time > now() - INTERVAL '30 days'
      GROUP BY bucket ORDER BY bucket ASC
    `),
    location ? forecast(location) : Promise.resolve(null),
  ]);
  if (outsideRes.status === "rejected") console.error("Ventilation forecast error:", outsideRes.reason);
  if (insideRes.status === "rejected") console.error("Ventilation inside error:", insideRes.reason);
  const outside = outsideRes.status === "fulfilled" ? outsideRes.value : null;
  return json({
    checkedAt: new Date().toISOString(),
    // Coordinates stay on the server for the Open-Meteo request. The page only needs to know if one is set.
    hasLocation: location != null,
    // `null` = couldn't load (vs `[]` = no readings)
    inside: insideRes.status === "fulfilled"
      ? insideRes.value
        .map((r) => ({ t: toMs(r.bucket), tempC: num(r.temperature), rhPct: num(r.humidity), co2: num(r.co2), hotC: num(r.temperature_max) }))
        .filter((r) => r.t != null)
      : null,
    // Hourly outside is only what suggestions and the forecast chart read. Sun stays the full 30 days.
    outside: outside?.outside ? outsideForPage(outside.outside, Date.now()) : null,
    sun: outside?.sun ?? [],
    forecastError: location != null && outside == null,
    thresholds: mergeVentThresholds(farm.ventilation),
    offsetHours: Number.isFinite(Number(farm.timezoneOffset)) ? Number(farm.timezoneOffset) : 2,
  });
}

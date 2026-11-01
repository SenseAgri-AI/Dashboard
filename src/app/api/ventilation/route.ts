import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";
import { mergeVentThresholds, parseOpenMeteo } from "@/lib/ventilation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Ventilation page data: inside climate (30-min averages, last 8 days, read-only) plus the outside
// forecast from Open-Meteo (free, no key) for the farm's configured location. Either part may be
// missing; the page says which.

function toMs(t: unknown): number | null {
  if (t == null) return null;
  const ms = t instanceof Date ? t.getTime()
    : typeof t === "bigint" ? Number(t) / 1e6
    : typeof t === "number" ? (t > 1e14 ? t / 1e6 : t)
    : new Date(String(t)).getTime();
  return Number.isFinite(ms) ? ms : null;
}
const num = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function validLocation(l: unknown): { lat: number; lon: number } | null {
  const o = l as { lat?: unknown; lon?: unknown } | null;
  const lat = Number(o?.lat), lon = Number(o?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

async function forecast(loc: { lat: number; lon: number }) {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${loc.lat}&longitude=${loc.lon}`
    + "&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,wind_speed_10m"
    + "&daily=sunrise,sunset&past_days=8&forecast_days=4&timezone=GMT&timeformat=unixtime";
  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return parseOpenMeteo(await res.json());
}

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
  const location = validLocation(farm.location);
  const [insideRes, outsideRes] = await Promise.allSettled([
    queryInflux<Record<string, unknown>>(`
      SELECT date_bin(INTERVAL '30 minutes', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
        AVG(temperature) AS temperature, AVG(humidity) AS humidity, AVG(co2) AS co2
      FROM sensors
      WHERE farm_id = '${String(farm.farmId).replace(/'/g, "''")}' AND device_type = 'AM308-1' AND time > now() - INTERVAL '8 days'
      GROUP BY bucket ORDER BY bucket ASC
    `),
    location ? forecast(location) : Promise.resolve(null),
  ]);
  if (outsideRes.status === "rejected") console.error("Ventilation forecast error:", outsideRes.reason);
  if (insideRes.status === "rejected") console.error("Ventilation inside error:", insideRes.reason);
  const outside = outsideRes.status === "fulfilled" ? outsideRes.value : null;
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    location,
    // `null` = couldn't load (vs `[]` = no readings)
    inside: insideRes.status === "fulfilled"
      ? insideRes.value
        .map((r) => ({ t: toMs(r.bucket), tempC: num(r.temperature), rhPct: num(r.humidity), co2: num(r.co2) }))
        .filter((r) => r.t != null)
      : null,
    outside: outside?.outside ?? null,
    sun: outside?.sun ?? [],
    forecastError: location != null && outside == null,
    thresholds: mergeVentThresholds(farm.ventilation),
    offsetHours: Number.isFinite(Number(farm.timezoneOffset)) ? Number(farm.timezoneOffset) : 2,
  });
}

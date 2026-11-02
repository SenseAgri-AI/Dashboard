import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Daily inside maximum (°C, from 30-min averages so one odd reading can't set it) for the last 15
// farm-local days, for the Home "This week" card. Read-only, farm-scoped. Water comes from
// /api/water-use and eggs/deaths from the DailyLog Home already loads. Docs: docs/this-week.md.
function toMs(t: unknown): number | null {
  if (t == null) return null;
  const ms = t instanceof Date ? t.getTime()
    : typeof t === "bigint" ? Number(t) / 1e6
    : typeof t === "number" ? (t > 1e14 ? t / 1e6 : t)
    : new Date(String(t)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
  const offset = Number.isInteger(farm.timezoneOffset) ? Number(farm.timezoneOffset) : 2;
  const origin = new Date(-offset * 3_600_000).toISOString().replace(".000Z", "Z"); // farm-local midnight
  const f = farm.farmId.replace(/'/g, "''");
  try {
    const rows = await queryInflux<{ day: unknown; tmax: unknown }>(`
      SELECT date_bin(INTERVAL '1 day', bucket, TIMESTAMP '${origin}') AS day, MAX(t) AS tmax
      FROM (
        SELECT date_bin(INTERVAL '30 minutes', time, TIMESTAMP '1970-01-01T00:00:00Z') AS bucket, AVG(temperature) AS t
        FROM sensors
        WHERE farm_id = '${f}' AND device_type = 'AM308-1' AND time > now() - INTERVAL '16 days'
          AND temperature > -20 AND temperature < 60
        GROUP BY 1
      )
      GROUP BY 1 ORDER BY 1`);
    const inside = rows.map((r) => {
      const ms = toMs(r.day);
      const t = r.tmax == null ? null : Number(r.tmax);
      return ms == null ? null : { date: new Date(ms + offset * 3_600_000).toISOString().slice(0, 10), maxC: t != null && Number.isFinite(t) ? t : null };
    }).filter((x) => x != null);
    return NextResponse.json({ inside, timezoneOffset: offset }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch {
    console.error("this-week: inside query failed");
    return NextResponse.json({ error: "Inside temperatures unavailable" }, { status: 502 });
  }
}

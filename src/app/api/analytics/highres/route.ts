import { NextRequest, NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// High-resolution recent analytics from InfluxDB (retains ~1 month). Env metrics only
// (AM308), averaged across the house's sensors, bucketed at the requested resolution.
// Returns mean + a [lo, hi] min–max band per metric, merged per bucket. Farm-scoped.
const ENV = new Set(["temperature", "humidity", "co2", "tvoc", "pm2_5", "pm10", "pressure", "light_level", "battery"]);
const RANGE: Record<string, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
const RES: Record<string, string> = { "15m": "15 minutes", "30m": "30 minutes", "1h": "1 hour", "3h": "3 hours", "6h": "6 hours" };
const round = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

export async function GET(req: NextRequest) {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (e) {
    if (e instanceof FarmAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const metrics = (searchParams.get("metrics") ?? "").split(",").map((s) => s.trim()).filter((m) => ENV.has(m)).slice(0, 2);
  const rangeIv = RANGE[searchParams.get("range") ?? "7d"] ?? "7 days";
  const resIv = RES[searchParams.get("resolution") ?? "1h"] ?? "1 hour";
  if (!metrics.length) return NextResponse.json({ error: "metrics required" }, { status: 400 });

  const bin = `date_bin(INTERVAL '${resIv}', time, TIMESTAMP '1970-01-01 00:00:00')`;
  const agg = metrics.flatMap((m) => [`avg(${m}) as ${m}`, `min(${m}) as ${m}__lo`, `max(${m}) as ${m}__hi`]).join(", ");

  // NB: alias the bucket `as time` — the influxdb3 Node client only converts a column
  // literally named `time` to a Date; any other name comes back as raw BigInt nanoseconds.
  const toIso = (v: unknown): string =>
    v instanceof Date ? v.toISOString()
      : typeof v === "bigint" ? new Date(Number(v) / 1_000_000).toISOString()
      : typeof v === "number" ? new Date(v).toISOString()
      : new Date(String(v)).toISOString();

  try {
    const rows = await queryInflux<Record<string, unknown>>(`
      SELECT ${bin} as time, ${agg}
      FROM sensors
      WHERE farm_id = '${farm.farmId}' AND device_type = 'AM308-1' AND time > now() - interval '${rangeIv}'
      GROUP BY ${bin}
      ORDER BY time ASC
    `);
    const series = rows.map((r) => {
      const point: Record<string, unknown> = { time: toIso(r.time) };
      for (const m of metrics) {
        point[m] = round(r[m]);
        const lo = round(r[`${m}__lo`]), hi = round(r[`${m}__hi`]);
        if (lo != null && hi != null) point[`${m}_band`] = [lo, hi];
      }
      return point;
    });
    return NextResponse.json({ series, source: "influx", resolution: resIv });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Influx query failed" }, { status: 500 });
  }
}

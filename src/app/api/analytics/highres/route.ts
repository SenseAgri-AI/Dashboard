import { NextRequest, NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";
import { thi, plausibleClimate } from "@/lib/thi";

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
  const requested = (searchParams.get("metrics") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const metrics = requested.filter((m) => ENV.has(m)).slice(0, 2);
  const wantNoise = requested.includes("noise"); // acoustic sound level, from audio_noise
  const wantWater = requested.includes("water"); // drinking rate — per-bucket litres from the meter
  const wantThi = requested.includes("thi");     // felt temperature — derived from temp + humidity
  const rangeIv = RANGE[searchParams.get("range") ?? "7d"] ?? "7 days";
  const resIv = RES[searchParams.get("resolution") ?? "1h"] ?? "1 hour";
  if (!metrics.length && !wantNoise && !wantWater && !wantThi) return NextResponse.json({ error: "metrics required" }, { status: 400 });

  const bin = `date_bin(INTERVAL '${resIv}', time, TIMESTAMP '1970-01-01 00:00:00')`;

  // NB: alias the bucket `as time` — the influxdb3 Node client only converts a column
  // literally named `time` to a Date; any other name comes back as raw BigInt nanoseconds.
  const toIso = (v: unknown): string =>
    v instanceof Date ? v.toISOString()
      : typeof v === "bigint" ? new Date(Number(v) / 1_000_000).toISOString()
      : typeof v === "number" ? new Date(v).toISOString()
      : new Date(String(v)).toISOString();

  try {
    // Env sensors (AM308) and the acoustic sound level (audio_noise) are separate measurements —
    // query each on the same time bins and merge per bucket so they share the plot's time axis.
    const byTime = new Map<string, Record<string, unknown>>();
    const point = (iso: string) => {
      let p = byTime.get(iso);
      if (!p) { p = { time: iso }; byTime.set(iso, p); }
      return p;
    };

    if (metrics.length) {
      const agg = metrics.flatMap((m) => [`avg(${m}) as ${m}`, `min(${m}) as ${m}__lo`, `max(${m}) as ${m}__hi`]).join(", ");
      const rows = await queryInflux<Record<string, unknown>>(`
        SELECT ${bin} as time, ${agg}
        FROM sensors
        WHERE farm_id = '${farm.farmId}' AND device_type = 'AM308-1' AND time > now() - interval '${rangeIv}'
        GROUP BY ${bin}
        ORDER BY time ASC
      `);
      for (const r of rows) {
        const p = point(toIso(r.time));
        for (const m of metrics) {
          p[m] = round(r[m]);
          const lo = round(r[`${m}__lo`]), hi = round(r[`${m}__hi`]);
          if (lo != null && hi != null) p[`${m}_band`] = [lo, hi];
        }
      }
    }

    if (wantNoise) {
      try {
        const rows = await queryInflux<Record<string, unknown>>(`
          SELECT ${bin} as time, avg(noise_db_mean) as noise
          FROM audio_noise
          WHERE farm_id = '${farm.farmId}' AND time > now() - interval '${rangeIv}'
          GROUP BY ${bin}
          ORDER BY time ASC
        `);
        for (const r of rows) point(toIso(r.time)).noise = round(r.noise);
      } catch (e) {
        console.error("High-res noise query failed:", e); // env metrics still render
      }
    }

    // Drinking rate: the water meter is a cumulative pulse counter, so per-bucket litres = the rise
    // in pulse_total × litres/pulse (mirrors the dashboard summary's meter handling).
    if (wantWater && farm.waterDeviceId) {
      try {
        const rows = await queryInflux<Record<string, unknown>>(`
          SELECT ${bin} as time, max(pulse_total) as cumulative
          FROM sensors
          WHERE farm_id = '${farm.farmId}' AND device_id = '${farm.waterDeviceId}' AND time > now() - interval '${rangeIv}'
          GROUP BY ${bin}
          ORDER BY time ASC
        `);
        const perPulse = farm.waterLitresPerPulse ?? 1;
        let prev: number | null = null;
        for (const r of rows) {
          const cum = Number(r.cumulative);
          if (!Number.isFinite(cum)) continue;
          if (prev != null) point(toIso(r.time)).water = round(Math.max(0, cum - prev) * perPulse);
          prev = cum;
        }
      } catch (e) {
        console.error("High-res water query failed:", e); // other metrics still render
      }
    }

    // Felt temperature (THI): exact per bucket from the bucket's mean temp + humidity (AM308 only).
    if (wantThi) {
      try {
        const rows = await queryInflux<Record<string, unknown>>(`
          SELECT ${bin} as time, avg(temperature) as t, avg(humidity) as h
          FROM sensors
          WHERE farm_id = '${farm.farmId}' AND device_type = 'AM308-1' AND time > now() - interval '${rangeIv}'
          GROUP BY ${bin}
          ORDER BY time ASC
        `);
        for (const r of rows) {
          const t = Number(r.t), h = Number(r.h);
          if (plausibleClimate(t, h)) point(toIso(r.time)).thi = round(thi(t, h));
        }
      } catch (e) {
        console.error("High-res THI query failed:", e); // other metrics still render
      }
    }

    const series = [...byTime.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return NextResponse.json({ series, source: "influx", resolution: resIv });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Influx query failed" }, { status: 500 });
  }
}

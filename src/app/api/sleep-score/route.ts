import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";
import { nightScores, type NoiseSample, type ClimateSample } from "@/lib/sleepScore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Flock Night-Rest Score per night, for the dashboard tile + trend. Farm-scoped.
function toMs(t: unknown): number {
  if (t == null) return NaN;
  return t instanceof Date ? t.getTime()
    : typeof t === "bigint" ? Number(t) / 1e6
    : typeof t === "number" ? (t > 1e14 ? t / 1e6 : t)
    : new Date(String(t)).getTime();
}

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  try {
    const [noiseRows, climateRows] = await Promise.all([
      queryInflux<Record<string, unknown>>(`
        SELECT time, noise_db_mean FROM audio_noise
        WHERE farm_id = '${farm.farmId}' AND time > now() - interval '15 days'
        ORDER BY time ASC`),
      queryInflux<Record<string, unknown>>(`
        SELECT time, temperature, humidity FROM sensors
        WHERE farm_id = '${farm.farmId}' AND device_type = 'AM308-1' AND time > now() - interval '15 days'
        ORDER BY time ASC`),
    ]);
    const samples: NoiseSample[] = noiseRows.map((r) => {
      const n = Number(r.noise_db_mean);
      return { t: toMs(r.time), mean: Number.isFinite(n) ? n : null };
    });
    const climate: ClimateSample[] = climateRows.map((r) => {
      const temp = Number(r.temperature), rh = Number(r.humidity);
      return { t: toMs(r.time), temp: Number.isFinite(temp) ? temp : null, rh: Number.isFinite(rh) ? rh : null };
    });
    return NextResponse.json({ nights: nightScores(samples, climate), updatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("sleep-score failed:", e);
    return NextResponse.json({ error: "Failed to compute sleep score" }, { status: 500 });
  }
}

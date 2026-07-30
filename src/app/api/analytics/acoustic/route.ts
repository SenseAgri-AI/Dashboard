import { NextRequest, NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { fetchNoiseSeries, fetchAnomalies, isAcousticRange, rangeHours } from "@/lib/acousticSource";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Flock-noise welfare series (InfluxDB `audio_noise`) + spike anomalies (S3 events). Farm-scoped:
// the caller's Clerk org resolves to a farm_id server-side. Noise and anomalies are fetched
// independently so one source being empty/slow never blanks the other (graceful empty states).
export async function GET(req: NextRequest) {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") ?? "24h";
  const rangeKey = isAcousticRange(range) ? range : "24h";
  const houseId = searchParams.get("house") || Object.keys(farm.houseHens ?? {})[0] || "house1";

  const toMs = Date.now();
  const fromMs = toMs - rangeHours(rangeKey) * 3_600_000;

  const [seriesR, anomR] = await Promise.allSettled([
    fetchNoiseSeries(farm.farmId, houseId, rangeKey),
    fetchAnomalies(farm.farmId, houseId, fromMs, toMs),
  ]);

  if (seriesR.status === "rejected") console.error("Acoustic noise query failed:", seriesR.reason);
  if (anomR.status === "rejected") console.error("Acoustic anomaly fetch failed:", anomR.reason);

  return NextResponse.json({
    series: seriesR.status === "fulfilled" ? seriesR.value : [],
    anomalies: anomR.status === "fulfilled" ? anomR.value : [],
    range: rangeKey,
    house: houseId,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import {
  fetchEggSeries, fetchEggTotalsToday, discoverEggCameras, resolveLatestEggClips,
  CAMERA_HOUSE, houseLabel, isEggRange, type EggRange, type ResolvedClips,
} from "@/lib/eggCountSource";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Assembled Egg-counting payload: per-camera counts (InfluxDB `egg_count`), today's totals, and the
// latest annotated clip per camera (S3, previous-day fallback). Farm-scoped — the caller's Clerk org
// resolves to a farm_id server-side. Counts and clips are fetched independently so one source being
// empty/slow never blanks the other (graceful empty states), mirroring the flock-noise route.

type CameraInfo = { cameraId: string; houseId: string | null; label: string };

export async function GET(req: NextRequest) {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const rangeParam = searchParams.get("range") ?? "24h";
  const range: EggRange = isEggRange(rangeParam) ? rangeParam : "24h";
  // clips=0 skips clip resolution — used by the client's 60s counts poll so refreshing the
  // numbers never re-signs (and reloads) the video players mid-playback.
  const skipClips = searchParams.get("clips") === "0";

  const [seriesR, totalsR, camerasR] = await Promise.allSettled([
    fetchEggSeries(farm.farmId, range),
    fetchEggTotalsToday(farm.farmId),
    discoverEggCameras(farm.farmId),
  ]);
  if (seriesR.status === "rejected") console.error("Egg series query failed:", seriesR.reason);
  if (totalsR.status === "rejected") console.error("Egg totals query failed:", totalsR.reason);
  if (camerasR.status === "rejected") console.error("Egg camera discovery failed:", camerasR.reason);

  const series = seriesR.status === "fulfilled" ? seriesR.value : [];
  const totals = totalsR.status === "fulfilled" ? totalsR.value : [];
  const s3Cameras = camerasR.status === "fulfilled" ? camerasR.value : [];

  // Reconcile the camera list: union of cameras seen in counts + cameras that have clips in S3.
  // house_id comes from live counts when present, else the CAMERA_HOUSE fallback map.
  const houseByCamera = new Map<string, string>();
  for (const row of series) if (row.cameraId && row.houseId) houseByCamera.set(row.cameraId, row.houseId);
  for (const t of totals) if (t.cameraId && t.houseId) houseByCamera.set(t.cameraId, t.houseId);

  const cameraIds = [...new Set([...houseByCamera.keys(), ...s3Cameras])].sort();
  const cameras: CameraInfo[] = cameraIds.map((cameraId) => {
    const houseId = houseByCamera.get(cameraId) ?? CAMERA_HOUSE[cameraId] ?? null;
    return { cameraId, houseId, label: houseId ? houseLabel(houseId) : cameraId };
  });

  // Pivot the long series into one row per bucket with a column per camera (for a multi-series chart).
  const byTime = new Map<string, Record<string, number | string>>();
  for (const row of series) {
    const point = byTime.get(row.time) ?? { time: row.time };
    point[row.cameraId] = (Number(point[row.cameraId] ?? 0) as number) + row.eggs;
    byTime.set(row.time, point);
  }
  const pivotedSeries = [...byTime.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));

  // Totals per camera (0 for a discovered camera with no counts today) + combined farm total.
  const totalByCamera = new Map(totals.map((t) => [t.cameraId, t.eggsToday]));
  const perCamera = cameras.map((c) => ({ ...c, eggsToday: totalByCamera.get(c.cameraId) ?? 0 }));
  const combined = perCamera.reduce((sum, c) => sum + c.eggsToday, 0);

  // Latest clip per camera (previous-day fallback baked in). Independent per camera so one failing
  // doesn't blank the other. Skipped on counts-only polls (clips=0).
  const clips = skipClips ? [] : await Promise.allSettled(
    cameras.map((c) => resolveLatestEggClips(farm.farmId, c.cameraId)),
  ).then((results) => cameras.map((c, i) => {
    const r = results[i];
    const resolved: ResolvedClips = r.status === "fulfilled" ? r.value : { cameraId: c.cameraId, date: null, isFallback: false, clips: [] };
    if (r.status === "rejected") console.error(`Egg clip resolve failed for ${c.cameraId}:`, r.reason);
    return { ...c, date: resolved.date, isFallback: resolved.isFallback, clips: resolved.clips };
  }));

  return NextResponse.json({
    range,
    cameras,
    series: pivotedSeries,
    totals: { perCamera, combined },
    clips,
    liveEstimate: true,
  });
}

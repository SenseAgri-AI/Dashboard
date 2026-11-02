import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { fetchWaterDaily } from "@/lib/silverSource";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Daily litres per water meter for the last 17 complete farm-local days (silver `meters_hourly`, read-only,
// farm-scoped) for the Today card's water check (lib/todayStatus.ts `waterUseCheck`). The silver table
// is filled by a daily batch, so "yesterday" appears in the early morning. Docs: docs/water-use-check.md.
const DAYS = 17;
const NAMES = ["Meter 1", "Meter 2"]; // silver columns water_l_wm1 / water_l_wm2 (docs/devices/water-meters.md)

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
  // First house only, like the analytics explorer: every farm today has one house with meters. A
  // multi-house farm needs a per-house check (docs/water-use-check.md).
  const houseId = Object.keys(farm.houseHens ?? {})[0] || "house1";
  const offset = Number.isInteger(farm.timezoneOffset) ? Number(farm.timezoneOffset) : 2;
  // Farm-local midnight today: complete local days only, and the same SQL all day so the Athena cache hits.
  const local = new Date(Date.now() + offset * 3_600_000);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset * 3_600_000;
  const from = new Date(today - DAYS * 86_400_000);
  try {
    const days = await fetchWaterDaily(farm.farmId, houseId, from.toISOString(), new Date(today).toISOString(), 22, offset);
    return NextResponse.json({ days, names: NAMES }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch {
    console.error("water-use: query failed");
    return NextResponse.json({ error: "Water use unavailable" }, { status: 502 });
  }
}

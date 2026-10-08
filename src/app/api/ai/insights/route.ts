import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { getWarningSigns, getHpedForecast } from "@/lib/aiDemo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AI insights for the Flock Vet panel: the warning-signs and lay-forecast snapshots for
// the caller's farm (resolved server-side from the Clerk org). Farms without a snapshot
// get nulls, and the panel shows an empty state.
export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
  return NextResponse.json({
    warningSigns: getWarningSigns(farm.farmId),
    forecast: getHpedForecast(farm.farmId),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { presignClip, CLIP_PREFIX } from "@/lib/acousticSource";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Presigned GET URL for an anomaly clip. Farm-scoped twice over: the caller must resolve to a farm,
// and the requested key must live under that farm's own path — so one org can never sign another
// org's clips.
export async function GET(req: NextRequest) {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key.startsWith(CLIP_PREFIX) || !key.includes(`farm_id=${farm.farmId}/`)) {
    return NextResponse.json({ error: "Invalid or out-of-scope clip key" }, { status: 400 });
  }

  try {
    return NextResponse.json({ url: await presignClip(key) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to sign clip" }, { status: 500 });
  }
}

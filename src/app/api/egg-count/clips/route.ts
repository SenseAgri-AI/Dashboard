import { NextRequest, NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { listEggClips, ID_RE, DATE_RE } from "@/lib/eggCountSource";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Presigned annotated clips for one camera on one date — powers the player's clip/date selector.
// Farm-scoped: the client sends only camera + date (never a raw S3 key); the server lists and presigns
// strictly under this farm's own prefix (clips/farm_id=<farm.farmId>/…), so one org can never reach
// another's clips.
export async function GET(req: NextRequest) {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const camera = searchParams.get("camera") ?? "";
  const date = searchParams.get("date") ?? "";
  if (!ID_RE.test(camera) || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "Invalid camera or date" }, { status: 400 });
  }

  try {
    const clips = await listEggClips(farm.farmId, camera, date);
    return NextResponse.json({ cameraId: camera, date, clips });
  } catch (e) {
    console.error("Egg clip listing failed:", e);
    return NextResponse.json({ error: "Failed to load clips" }, { status: 500 });
  }
}

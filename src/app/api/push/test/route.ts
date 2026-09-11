import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { sendToUser } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Send a test notification to the caller's OWN devices (within their farm) — proves the pipe without
// buzzing everyone else on the farm. The real recurring alerts use sendToFarm() from the platform.
export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (e) {
    if (e instanceof FarmAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
  try {
    const res = await sendToUser(farm.farmId, userId, {
      title: "SenseAgri · test 🐔",
      body: "If you can see this, push notifications are working.",
      url: "/dashboard",
      tag: "senseagri-test",
    });
    if (res.sent === 0) {
      return NextResponse.json({ error: "No active subscription for this device — tap “Enable notifications” first." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 500 });
  }
}

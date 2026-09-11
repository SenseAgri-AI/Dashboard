import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { validSubscription, validPushEndpoint } from "@/lib/pushValidation";
import { saveSubscription, deleteSubscription, getFarmSubscriptions } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Store (POST) or remove (DELETE) this device's push subscription, scoped to the caller's farm.
// The farm is resolved from the Clerk org (getFarmForRequest); the Clerk userId is kept on the row.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (e) {
    if (e instanceof FarmAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  if (!validSubscription(sub)) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  try {
    await saveSubscription(farm.farmId, userId, { endpoint: sub.endpoint, keys: sub.keys });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (e) {
    if (e instanceof FarmAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (!validPushEndpoint(endpoint)) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  try {
    await deleteSubscription(farm.farmId, endpoint, userId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to remove subscription" }, { status: 500 });
  }
}

// The browser can retain a subscription after its server row was pruned. Check
// the current user's farm registration before showing it as enabled.
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const farm = await getFarmForRequest();
    const endpoint = req.nextUrl.searchParams.get("endpoint");
    const subscriptions = await getFarmSubscriptions(farm.farmId);
    return NextResponse.json({ subscribed: subscriptions.some((s) => s.userId === userId && s.endpoint === endpoint) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "Could not check notification status" }, { status: e instanceof FarmAccessError ? 403 : 500 });
  }
}

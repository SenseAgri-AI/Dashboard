import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { sendToDevice } from "@/lib/push";
import { validPushEndpoint } from "@/lib/pushValidation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The browser supplies its own endpoint, which must belong to this user and farm.
// Missing/old clients fail closed rather than testing every saved device.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!validPushEndpoint(body?.endpoint) || typeof body?.testId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.testId)) {
    return NextResponse.json({ error: "Reload the app and enable notifications on this device before testing." }, { status: 400 });
  }
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (e) {
    if (e instanceof FarmAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
  try {
    const result = await sendToDevice(farm.farmId, userId, body.endpoint, {
      title: "SenseAgri · test 🐔",
      body: "If you can see this, push notifications are working.",
      url: "/dashboard",
      tag: `senseagri-test-${body.testId}`,
      testId: body.testId,
    });
    if (result !== "accepted") {
      return NextResponse.json({ error: "This device needs to be registered again — tap Re-enable, then test again." }, { status: result === "expired" ? 410 : 404 });
    }
    return NextResponse.json({ accepted: true, testId: body.testId });
  } catch (e) {
    console.error("push: device test failed", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "The test could not be sent. Please try again later." }, { status: 502 });
  }
}

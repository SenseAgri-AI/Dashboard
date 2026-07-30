import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { listVersions, saveVersion, deleteVersion, normalizeVersion } from "@/lib/scheduleService";

export const dynamic = "force-dynamic";

const err = (status: number, error: string) => NextResponse.json({ error }, { status });

async function resolveFarm() {
  try {
    return { farm: await getFarmForRequest() };
  } catch (e) {
    if (e instanceof FarmAccessError) return { error: err(403, e.message) };
    return { error: err(500, "Failed to resolve farm") };
  }
}

export async function GET() {
  const r = await resolveFarm();
  if (r.error) return r.error;
  try {
    return NextResponse.json({ versions: await listVersions(r.farm!.spreadsheetId) });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Failed to load schedule");
  }
}

export async function POST(request: Request) {
  const r = await resolveFarm();
  if (r.error) return r.error;
  try {
    const user = await currentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress ?? user?.id ?? "";
    const version = normalizeVersion((await request.json()) as Record<string, unknown>, email);
    return NextResponse.json({ version: await saveVersion(r.farm!.spreadsheetId, version) });
  } catch (e) {
    return err(400, e instanceof Error ? e.message : "Failed to save action");
  }
}

export async function DELETE(request: Request) {
  const r = await resolveFarm();
  if (r.error) return r.error;
  try {
    const { searchParams } = new URL(request.url);
    const scheduleId = searchParams.get("scheduleId");
    const effectiveDate = searchParams.get("effectiveDate") ?? undefined;
    if (!scheduleId) return err(400, "scheduleId is required");
    await deleteVersion(r.farm!.spreadsheetId, scheduleId, effectiveDate);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Failed to delete action");
  }
}

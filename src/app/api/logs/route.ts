import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { listEntries, upsertEntry, deleteEntry, normalizeEntry, isIsoDate } from "@/lib/logService";

export const dynamic = "force-dynamic";

async function resolveFarmOr(res: (status: number, msg: string) => NextResponse) {
  try {
    return { farm: await getFarmForRequest() };
  } catch (err) {
    if (err instanceof FarmAccessError) return { error: res(403, err.message) };
    return { error: res(500, "Failed to resolve farm") };
  }
}

const err = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET() {
  const r = await resolveFarmOr(err);
  if (r.error) return r.error;
  try {
    const entries = await listEntries(r.farm!.spreadsheetId);
    return NextResponse.json({ entries });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Failed to load entries");
  }
}

export async function POST(request: Request) {
  const r = await resolveFarmOr(err);
  if (r.error) return r.error;
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const entry = normalizeEntry(payload);
    const saved = await upsertEntry(r.farm!.spreadsheetId, entry);
    return NextResponse.json({ entry: saved });
  } catch (e) {
    return err(400, e instanceof Error ? e.message : "Failed to save entry");
  }
}

export async function DELETE(request: Request) {
  const r = await resolveFarmOr(err);
  if (r.error) return r.error;
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const houseId = searchParams.get("house");
    if (!date || !isIsoDate(date)) return err(400, "Valid date is required");
    if (!houseId) return err(400, "House is required");
    await deleteEntry(r.farm!.spreadsheetId, date, houseId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Failed to delete entry");
  }
}

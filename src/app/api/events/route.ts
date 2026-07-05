import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { listEvents, addEvent, deleteEvent, normalizeEvent } from "@/lib/eventService";

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
    return NextResponse.json({ events: await listEvents(r.farm!.spreadsheetId) });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Failed to load events");
  }
}

export async function POST(request: Request) {
  const r = await resolveFarm();
  if (r.error) return r.error;
  try {
    const user = await currentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress ?? user?.id ?? "";
    const event = normalizeEvent((await request.json()) as Record<string, unknown>, email);
    return NextResponse.json({ event: await addEvent(r.farm!.spreadsheetId, event) });
  } catch (e) {
    return err(400, e instanceof Error ? e.message : "Failed to save event");
  }
}

export async function DELETE(request: Request) {
  const r = await resolveFarm();
  if (r.error) return r.error;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return err(400, "id is required");
    await deleteEvent(r.farm!.spreadsheetId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Failed to delete event");
  }
}

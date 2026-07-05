import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { listHouses, upsertHouse, normalizeHouse } from "@/lib/logService";

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
    const houses = await listHouses(r.farm!.spreadsheetId);
    return NextResponse.json({ houses });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Failed to load houses");
  }
}

export async function POST(request: Request) {
  const r = await resolveFarm();
  if (r.error) return r.error;
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const house = normalizeHouse(payload);
    const saved = await upsertHouse(r.farm!.spreadsheetId, house);
    return NextResponse.json({ house: saved });
  } catch (e) {
    return err(400, e instanceof Error ? e.message : "Failed to save house");
  }
}

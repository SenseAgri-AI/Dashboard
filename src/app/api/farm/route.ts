import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";

export const dynamic = "force-dynamic";

// Non-sensitive display info about the caller's farm (e.g. a link to their sheet).
export async function GET() {
  try {
    const farm = await getFarmForRequest();
    return NextResponse.json({
      farmId: farm.farmId,
      spreadsheetId: farm.spreadsheetId,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${farm.spreadsheetId}/edit`,
    });
  } catch (e) {
    if (e instanceof FarmAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
}

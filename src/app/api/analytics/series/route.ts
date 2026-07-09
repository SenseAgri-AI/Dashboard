import { NextRequest, NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { fetchSilverDaily, isSilverMetric, type DailyRow } from "@/lib/silverSource";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Computed metrics (derived from silver, not raw columns).
const HDEP = "hdep";
const CUM_MORT = "cum_mortality"; // cumulative deaths since day 1 / starting flock × 100
const BREAKAGE = "breakage_rate"; // damaged eggs / total eggs × 100 (per day)
const COMPUTED = [HDEP, CUM_MORT, BREAKAGE];
const round = (v: number | null, dp = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);

// Deep-history analytics from the silver layer (Athena), daily-aggregated. Farm-scoped:
// the caller's Clerk org resolves to a farm_id server-side. Returns a merged daily frame
// with one value per requested metric, so the chart can plot two on dual axes.
export async function GET(req: NextRequest) {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const metrics = (searchParams.get("metrics") ?? searchParams.get("metric") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const houseId = searchParams.get("house") || Object.keys(farm.houseHens ?? {})[0] || "house1";

  if (!metrics.length) return NextResponse.json({ error: "metrics required" }, { status: 400 });
  if (!from || !to) return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  const bad = metrics.find((m) => !COMPUTED.includes(m) && !isSilverMetric(m));
  if (bad) return NextResponse.json({ error: `Unknown metric: ${bad}` }, { status: 400 });

  const rawCols = metrics.filter((m) => !COMPUTED.includes(m));
  const wantHdep = metrics.includes(HDEP);
  const wantCumMort = metrics.includes(CUM_MORT);
  const wantBreakage = metrics.includes(BREAKAGE);
  const byDay = new Map<string, DailyRow>();

  try {
    // Raw columns over the display range.
    if (rawCols.length) {
      for (const row of await fetchSilverDaily(farm.farmId, houseId, rawCols, from, to)) {
        const day = String(row.time).slice(0, 10);
        const point: DailyRow = { time: row.time };
        for (const c of rawCols) {
          point[c] = round(row[c] as number | null);
          const lo = round(row[`${c}__lo`] as number | null);
          const hi = round(row[`${c}__hi`] as number | null);
          if (lo != null && hi != null) point[`${c}_band`] = [lo, hi]; // daily min–max range
        }
        byDay.set(day, point);
      }
    }

    // HDEP / cumulative-mortality% need mortality accumulated from the flock's start; breakage-rate
    // is a per-day ratio. All derive from the same daily egg/mortality history — fetch it once.
    if (wantHdep || wantCumMort || wantBreakage) {
      const totalHens = Object.values(farm.houseHens ?? {}).reduce((a, b) => a + b, 0);
      const hist = await fetchSilverDaily(farm.farmId, houseId, ["eggs_total", "mortality", "eggs_damaged"], "2025-01-01T00:00:00Z", to);
      const fromDay = from.slice(0, 10), toDay = to.slice(0, 10);
      let cumMortality = 0;
      for (const row of hist) {
        cumMortality += Number(row.mortality) || 0;
        const day = String(row.time).slice(0, 10);
        if (day < fromDay || day >= toDay) continue;
        const eggs = typeof row.eggs_total === "number" ? row.eggs_total : null; // null = no egg log → gap, not 0
        const point = byDay.get(day) ?? { time: row.time };
        if (wantHdep) {
          const liveHens = Math.max(1, totalHens - cumMortality);
          point[HDEP] = totalHens > 0 && eggs != null ? round((eggs / liveHens) * 100, 1) : null;
        }
        if (wantCumMort) {
          point[CUM_MORT] = totalHens > 0 ? round((cumMortality / totalHens) * 100, 2) : null;
        }
        if (wantBreakage) {
          const dmg = typeof row.eggs_damaged === "number" ? row.eggs_damaged : null;
          point[BREAKAGE] = eggs != null && eggs > 0 && dmg != null ? round((dmg / eggs) * 100, 2) : null;
        }
        byDay.set(day, point);
      }
    }

    const series = [...byDay.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return NextResponse.json({ series, metrics, grain: "daily", house: houseId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Silver query failed" }, { status: 500 });
  }
}

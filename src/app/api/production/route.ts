import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSheetValues } from "@/lib/sheets";

const SPREADSHEET_ID = "1KjAr1wjfptYbE0n3qCWY_7gTVnR-XMTRy8xzRgCDpkA";
const SHEET_RANGE = "DailyLog!A:J";

// Hen counts per house — update when new flock placed
const HOUSE_HENS: Record<string, number> = {
  house1: 4479,
};
const TOTAL_HENS = Object.values(HOUSE_HENS).reduce((a, b) => a + b, 0);

// Egg pricing tiers (price per egg in ZAR) — most recent tier takes precedence
const PRICE_TIERS = [
  { from: "2026-04-01", small: 1.20, medium: 1.50, large: 1.80, xl: 2.00, jumbo: 2.20 },
  { from: "2025-10-01", small: 1.00, medium: 1.30, large: 1.60, xl: 1.80, jumbo: 2.00 },
];

function getPrices(dateKey: string) {
  for (const tier of PRICE_TIERS) {
    if (dateKey >= tier.from) return tier;
  }
  return PRICE_TIERS[PRICE_TIERS.length - 1];
}

// Normalise to YYYY-MM-DD. Handles DD/MM/YYYY and YYYY-MM-DD.
function normDate(raw: string): string | null {
  if (!raw) return null;
  const parts = raw.trim().split(/[\/\-]/);
  if (parts.length !== 3) return null;
  let y: string, m: string, d: string;
  if (parts[0].length === 4) {
    [y, m, d] = parts;
  } else {
    [d, m, y] = parts;
  }
  if (!y || !m || !d) return null;
  const key = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isNaN(new Date(key).getTime()) ? null : key;
}

function toInt(v: string | undefined): number {
  const n = parseInt(v ?? "", 10);
  return isNaN(n) ? 0 : n;
}

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await getSheetValues(SPREADSHEET_ID, SHEET_RANGE);

    // Skip header row — keep only rows with a valid date
    const dataRows = rows
      .map((r) => ({ key: normDate(r[0]), r }))
      .filter((x): x is { key: string; r: string[] } => x.key !== null);

    if (dataRows.length === 0) {
      return NextResponse.json({ error: "No production data" }, { status: 404 });
    }

    // Sort descending by date string (YYYY-MM-DD sorts lexicographically)
    dataRows.sort((a, b) => b.key.localeCompare(a.key));

    const latestKey = dataRows[0].key;
    const todayRows = dataRows.filter((x) => x.key === latestKey);

    let small = 0, medium = 0, large = 0, xl = 0, jumbo = 0, damaged = 0, mortality = 0;
    for (const { r } of todayRows) {
      // cols: Date(0), House(1), Small(2), Medium(3), Large(4), XL(5), J/Jumbo(6), Damaged(7), Mortality(8)
      small    += toInt(r[2]);
      medium   += toInt(r[3]);
      large    += toInt(r[4]);
      xl       += toInt(r[5]);
      jumbo    += toInt(r[6]);
      damaged  += toInt(r[7]);
      mortality += toInt(r[8]);
    }

    const totalEggs = small + medium + large + xl + jumbo;
    const prices = getPrices(latestKey);
    const revenue =
      small  * prices.small  +
      medium * prices.medium +
      large  * prices.large  +
      xl     * prices.xl     +
      jumbo  * prices.jumbo;

    const hdep = TOTAL_HENS > 0 ? (totalEggs / TOTAL_HENS) * 100 : null;

    // Cumulative mortality across all rows up to and including latestKey
    let cumulativeMortality = 0;
    for (const { r } of dataRows) {
      cumulativeMortality += toInt(r[8]);
    }
    const mortalityRate = TOTAL_HENS > 0
      ? (cumulativeMortality / (TOTAL_HENS + cumulativeMortality)) * 100
      : null;

    // Aggregate by date for 7-day trend
    const dailyMap = new Map<string, { eggs: number; revenue: number }>();
    for (const { key, r } of dataRows) {
      const s = toInt(r[2]), me = toInt(r[3]), la = toInt(r[4]), x = toInt(r[5]), j = toInt(r[6]);
      const dayEggs = s + me + la + x + j;
      const p = getPrices(key);
      const dayRev = s * p.small + me * p.medium + la * p.large + x * p.xl + j * p.jumbo;
      const existing = dailyMap.get(key);
      if (existing) {
        existing.eggs += dayEggs;
        existing.revenue += dayRev;
      } else {
        dailyMap.set(key, { eggs: dayEggs, revenue: dayRev });
      }
    }

    // Build cutoff 6 days before latest date using string arithmetic
    const cutoffDate = new Date(latestKey);
    cutoffDate.setDate(cutoffDate.getDate() - 6);
    const cutoffKey = cutoffDate.toISOString().slice(0, 10);

    const daily7d = Array.from(dailyMap.entries())
      .filter(([k]) => k >= cutoffKey)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        eggs: v.eggs,
        revenue: Math.round(v.revenue * 100) / 100,
        hdep: TOTAL_HENS > 0 ? Math.round((v.eggs / TOTAL_HENS) * 1000) / 10 : null,
      }));

    return NextResponse.json({
      date: latestKey,
      eggs: { total: totalEggs, small, medium, large, xl, jumbo, damaged },
      revenue: Math.round(revenue * 100) / 100,
      hdep: hdep !== null ? Math.round(hdep * 10) / 10 : null,
      mortality: {
        today: mortality,
        cumulative: cumulativeMortality,
        rate: mortalityRate !== null ? Math.round(mortalityRate * 100) / 100 : null,
      },
      totalHens: TOTAL_HENS,
      daily: daily7d,
    });
  } catch (err) {
    console.error("Production API error:", err);
    return NextResponse.json({ error: "Failed to fetch production data" }, { status: 500 });
  }
}

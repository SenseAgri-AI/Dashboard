import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSheetValues } from "@/lib/sheets";
import { queryInflux, FARM_ID } from "@/lib/influxdb";

const SPREADSHEET_ID = "1KjAr1wjfptYbE0n3qCWY_7gTVnR-XMTRy8xzRgCDpkA";
const SHEET_RANGE = "DailyLog!A:J";
const FEED_DEVICE_ID = "24e124136f452271";

const HOUSE_HENS: Record<string, number> = {
  house1: 4479,
};
const TOTAL_HENS = Object.values(HOUSE_HENS).reduce((a, b) => a + b, 0);

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

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

interface FeedRow {
  bucket: string | Date;
  cumulative?: number | null;
}

function prevDayKey(dateKey: string): string {
  const d = new Date(dateKey + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function nextDayKey(dateKey: string): string {
  const d = new Date(dateKey + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Attribute feed pulses by farm-day logic:
// The FIRST fill of each UTC calendar day is the previous evening's top-up
// and belongs to the previous day. All subsequent fills that day are current-day.
function feedDailyMap(rows: FeedRow[]): Map<string, number> {
  let prev: number | null = null;
  const firstFillSeen = new Set<string>();
  const map = new Map<string, number>();

  for (const row of rows) {
    const cumulative = toNum(row.cumulative);
    const iso = (row.bucket instanceof Date
      ? row.bucket.toISOString()
      : new Date(row.bucket).toISOString()
    );
    const dateKey = iso.slice(0, 10);

    if (cumulative !== null && prev !== null) {
      const delta = Math.max(0, cumulative - prev);
      if (delta > 0) {
        if (!firstFillSeen.has(dateKey)) {
          // First fill of this calendar day → belongs to the previous day
          firstFillSeen.add(dateKey);
          const target = prevDayKey(dateKey);
          map.set(target, (map.get(target) ?? 0) + delta);
        } else {
          // Subsequent fills → current day
          map.set(dateKey, (map.get(dateKey) ?? 0) + delta);
        }
      }
    }
    if (cumulative !== null) prev = cumulative;
  }
  return map;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from"); // YYYY-MM-DD, optional
  const toParam   = searchParams.get("to");   // YYYY-MM-DD, optional

  try {
    const [sheetRows, feedRows] = await Promise.all([
      getSheetValues(SPREADSHEET_ID, SHEET_RANGE),
      queryInflux<FeedRow>(`
        SELECT
          date_bin(INTERVAL '1 hour', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
          MAX(pulse_total) AS cumulative
        FROM sensors
        WHERE farm_id = '${FARM_ID}'
          AND device_id = '${FEED_DEVICE_ID}'
          AND time > now() - INTERVAL '32 days'
        GROUP BY bucket
        ORDER BY bucket ASC
      `),
    ]);

    const feedByDay = feedDailyMap(feedRows);

    const dataRows = sheetRows
      .map((r) => ({ key: normDate(r[0]), r }))
      .filter((x): x is { key: string; r: string[] } => x.key !== null);

    if (dataRows.length === 0) {
      return NextResponse.json({ error: "No production data" }, { status: 404 });
    }

    dataRows.sort((a, b) => b.key.localeCompare(a.key));

    const latestKey = dataRows[0].key;
    const todayRows = dataRows.filter((x) => x.key === latestKey);

    let small = 0, medium = 0, large = 0, xl = 0, jumbo = 0, damaged = 0, mortality = 0;
    for (const { r } of todayRows) {
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

    let cumulativeMortality = 0;
    for (const { r } of dataRows) {
      cumulativeMortality += toInt(r[8]);
    }
    const liveHens = Math.max(1, TOTAL_HENS - cumulativeMortality);
    const hdep = TOTAL_HENS > 0 ? (totalEggs / liveHens) * 100 : null;
    const mortalityRate = TOTAL_HENS > 0
      ? (cumulativeMortality / (TOTAL_HENS + cumulativeMortality)) * 100
      : null;

    // Aggregate egg/revenue by date
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

    const defaultCutoff = new Date(latestKey);
    defaultCutoff.setDate(defaultCutoff.getDate() - 29);
    const cutoffKey = fromParam ?? defaultCutoff.toISOString().slice(0, 10);
    const endKey    = toParam   ?? latestKey;

    const daily30d = Array.from(dailyMap.entries())
      .filter(([k]) => k >= cutoffKey && k <= endKey)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        const feedPulses = feedByDay.get(date) ?? null;
        // FCR: feed consumed on Day N-1 produced eggs collected on Day N
        const prevFeed = feedByDay.get(prevDayKey(date)) ?? null;
        const fcr = prevFeed !== null && v.eggs > 0
          ? Math.round((prevFeed / v.eggs) * 100) / 100
          : null;
        return {
          date,
          eggs: v.eggs,
          revenue: Math.round(v.revenue * 100) / 100,
          hdep: TOTAL_HENS > 0 ? Math.round((v.eggs / liveHens) * 1000) / 10 : null,
          feedPulses,
          fcr,
        };
      });

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
      daily: daily30d,
    });
  } catch (err) {
    console.error("Production API error:", err);
    return NextResponse.json({ error: "Failed to fetch production data" }, { status: 500 });
  }
}

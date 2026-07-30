import { NextResponse } from "next/server";
import { getSheetValues } from "@/lib/sheets";
import { queryInflux } from "@/lib/influxdb";
import { getFarmForRequest, FarmAccessError, type PriceTier } from "@/lib/farms";

// Farm-specific values (sheet, feed device, hens, price tiers) come from per-farm
// config (src/lib/farms.ts). priceTiers must be ordered newest-first.
function getPrices(dateKey: string, tiers: PriceTier[]): PriceTier {
  for (const tier of tiers) {
    if (dateKey >= tier.from) return tier;
  }
  return tiers[tiers.length - 1];
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
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
  const TOTAL_HENS = Object.values(farm.houseHens).reduce((a, b) => a + b, 0);

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from"); // YYYY-MM-DD, optional
  const toParam   = searchParams.get("to");   // YYYY-MM-DD, optional

  try {
    const [sheetRows, feedRows] = await Promise.all([
      getSheetValues(farm.spreadsheetId, farm.sheetRange),
      queryInflux<FeedRow>(`
        SELECT
          date_bin(INTERVAL '1 hour', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
          MAX(pulse_total) AS cumulative
        FROM sensors
        WHERE farm_id = '${farm.farmId}'
          AND device_id = '${farm.feedDeviceId}'
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
    const prices = getPrices(latestKey, farm.priceTiers);
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

    // Aggregate per day (a day may have several house rows). r[10] = avg egg weight (g).
    type DayAgg = {
      eggs: number; revenue: number; small: number; medium: number; large: number; xl: number; jumbo: number;
      damaged: number; mortality: number; weightSum: number; weightCount: number;
    };
    const emptyAgg = (): DayAgg => ({ eggs: 0, revenue: 0, small: 0, medium: 0, large: 0, xl: 0, jumbo: 0, damaged: 0, mortality: 0, weightSum: 0, weightCount: 0 });
    const dailyMap = new Map<string, DayAgg>();
    for (const { key, r } of dataRows) {
      const s = toInt(r[2]), me = toInt(r[3]), la = toInt(r[4]), x = toInt(r[5]), j = toInt(r[6]);
      const dmg = toInt(r[7]), mort = toInt(r[8]), w = toNum(r[10]);
      const dayEggs = s + me + la + x + j;
      const p = getPrices(key, farm.priceTiers);
      const cur = dailyMap.get(key) ?? emptyAgg();
      cur.eggs += dayEggs;
      cur.revenue += s * p.small + me * p.medium + la * p.large + x * p.xl + j * p.jumbo;
      cur.small += s; cur.medium += me; cur.large += la; cur.xl += x; cur.jumbo += j;
      cur.damaged += dmg; cur.mortality += mort;
      if (w !== null) { cur.weightSum += w; cur.weightCount += 1; }
      dailyMap.set(key, cur);
    }

    // Running live-hens by day across ALL logged days (ascending), for accurate per-day HDEP.
    const allDaysAsc = [...dailyMap.keys()].sort((a, b) => a.localeCompare(b));
    const liveHensByDay = new Map<string, number>();
    let runningMort = 0;
    for (const day of allDaysAsc) {
      runningMort += dailyMap.get(day)!.mortality;
      liveHensByDay.set(day, Math.max(1, TOTAL_HENS - runningMort));
    }

    const defaultCutoff = new Date(latestKey);
    defaultCutoff.setDate(defaultCutoff.getDate() - 29);
    const cutoffKey = fromParam ?? defaultCutoff.toISOString().slice(0, 10);
    const endKey    = toParam   ?? latestKey;

    const daily30d = allDaysAsc
      .filter((k) => k >= cutoffKey && k <= endKey)
      .map((date) => {
        const v = dailyMap.get(date)!;
        const lh = liveHensByDay.get(date) ?? liveHens;
        const feedPulses = feedByDay.get(date) ?? null;
        // FCR: feed consumed on Day N-1 produced eggs collected on Day N
        const prevFeed = feedByDay.get(prevDayKey(date)) ?? null;
        const fcr = prevFeed !== null && v.eggs > 0
          ? Math.round((prevFeed / v.eggs) * 100) / 100
          : null;
        return {
          date,
          eggs: v.eggs,
          small: v.small, medium: v.medium, large: v.large, xl: v.xl, jumbo: v.jumbo,
          damaged: v.damaged,
          mortality: v.mortality,
          liveHens: lh,
          avgWeight: v.weightCount > 0 ? Math.round((v.weightSum / v.weightCount) * 10) / 10 : null,
          revenue: Math.round(v.revenue * 100) / 100,
          hdep: TOTAL_HENS > 0 ? Math.round((v.eggs / lh) * 1000) / 10 : null,
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

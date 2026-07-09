// Silver-layer reader — queries the aligned-hourly analytics table in S3 via Athena.
//
// The "deep history" source behind the analytics explorer. Glue DB `senseagri_silver`,
// table `aligned_hourly`, partition projection on farm_id/house_id/year/month (no crawler).
// Reads only; the app's IAM user carries `senseagri-dev-silver-app-read`.

import {
  AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand,
} from "@aws-sdk/client-athena";

const DATABASE = "senseagri_silver";
const TABLE = "aligned_hourly";
const WORKGROUP = "senseagri"; // enforces its own result-output location

// Numeric columns that may be selected — guards the string-built SQL against injection.
export const SILVER_METRICS = [
  "temperature", "humidity", "co2", "tvoc", "pm2_5", "pm10", "pressure", "light_level", "battery",
  "water_litres", "feed_kg",
  "eggs_total", "eggs_small", "eggs_medium", "eggs_large", "eggs_xl", "eggs_jumbo", "eggs_damaged",
  "avg_egg_weight", "mortality", "deaths", "photoperiod_h", "n",
] as const;
export type SilverMetric = (typeof SILVER_METRICS)[number];
export const isSilverMetric = (m: string): m is SilverMetric => (SILVER_METRICS as readonly string[]).includes(m);

// A daily row: `time` (ISO) plus numeric (or null) values per column, and optional [lo, hi] bands.
export type DailyRow = Record<string, number | string | null | number[]>;

const ID_RE = /^[A-Za-z0-9_]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;

let _client: AthenaClient | null = null;
function client(): AthenaClient {
  if (!_client) _client = new AthenaClient({ region: process.env.AWS_REGION ?? "af-south-1" });
  return _client;
}

// Historical partitions are immutable; the open month refreshes daily → short TTL.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; rows: (string | undefined)[][] }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function athenaTsToIso(s: string): string {
  const cleaned = s.trim().replace(" ", "T");
  const d = new Date(cleaned.endsWith("Z") ? cleaned : `${cleaned}Z`);
  return isNaN(d.getTime()) ? s : d.toISOString();
}
function toAthenaTs(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error("Invalid timestamp");
  return d.toISOString().slice(0, 19).replace("T", " ");
}
const toNum = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Low-level: run SQL, poll to completion, return data rows (header stripped), cached by SQL.
async function runAthenaRaw(sql: string): Promise<(string | undefined)[][]> {
  const hit = cache.get(sql);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

  const c = client();
  const start = await c.send(new StartQueryExecutionCommand({
    QueryString: sql, WorkGroup: WORKGROUP, QueryExecutionContext: { Database: DATABASE },
  }));
  const id = start.QueryExecutionId!;

  for (let i = 0; i < 50; i++) {
    const ex = await c.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
    const state = ex.QueryExecution?.Status?.State;
    if (state === "SUCCEEDED") break;
    if (state === "FAILED" || state === "CANCELLED") {
      throw new Error(`Athena query ${state}: ${ex.QueryExecution?.Status?.StateChangeReason ?? ""}`);
    }
    await sleep(400);
  }

  const out: (string | undefined)[][] = [];
  let nextToken: string | undefined;
  let firstPage = true;
  do {
    const res = await c.send(new GetQueryResultsCommand({ QueryExecutionId: id, NextToken: nextToken, MaxResults: 1000 }));
    const rows = res.ResultSet?.Rows ?? [];
    for (let r = firstPage ? 1 : 0; r < rows.length; r++) {
      out.push((rows[r].Data ?? []).map((d) => d.VarCharValue));
    }
    firstPage = false;
    nextToken = res.NextToken;
  } while (nextToken);

  cache.set(sql, { at: Date.now(), rows: out });
  return out;
}

/** Daily aggregates for the given columns over [from, to): mean (`c`) plus the day's
 *  min (`c__lo`) and max (`c__hi`), one row per day. */
export async function fetchSilverDaily(
  farmId: string, houseId: string, columns: string[], from: string, to: string,
): Promise<DailyRow[]> {
  const cols = [...new Set(columns.filter(isSilverMetric))];
  if (!ID_RE.test(farmId) || !ID_RE.test(houseId)) throw new Error("Invalid farm/house id");
  if (!ISO_RE.test(from) || !ISO_RE.test(to)) throw new Error("Invalid date range");
  const fromYear = new Date(from).getUTCFullYear();
  const toYear = new Date(to).getUTCFullYear();
  const sel = cols.flatMap((c) => [
    `avg(CAST(${c} AS double)) AS ${c}`,
    `min(CAST(${c} AS double)) AS ${c}__lo`,
    `max(CAST(${c} AS double)) AS ${c}__hi`,
  ]).join(", ");

  const sql = `SELECT date_trunc('day', bucket_start) AS t${cols.length ? ", " + sel : ""}
    FROM ${DATABASE}.${TABLE}
    WHERE farm_id = '${farmId}' AND house_id = '${houseId}' AND year BETWEEN ${fromYear} AND ${toYear}
      AND bucket_start >= timestamp '${toAthenaTs(from)}' AND bucket_start < timestamp '${toAthenaTs(to)}'
    GROUP BY 1 ORDER BY 1`;

  const rows = await runAthenaRaw(sql);
  return rows.map((cells) => {
    const rec: DailyRow = { time: athenaTsToIso(cells[0] ?? "") };
    cols.forEach((c, i) => {
      rec[c] = toNum(cells[1 + i * 3]);
      rec[`${c}__lo`] = toNum(cells[2 + i * 3]);
      rec[`${c}__hi`] = toNum(cells[3 + i * 3]);
    });
    return rec;
  });
}

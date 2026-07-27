// Acoustic-layer reader — flock-noise series (InfluxDB) + anomaly events & clips (S3).
//
// The "Flock noise" welfare feature. Noise level per minute lives in the same InfluxDB as sensor
// telemetry (`audio_noise` measurement); spike anomalies are JSON events in the raw S3 bucket, each
// pointing at a ~30 s WAV clip in the media-inference bucket. Reads only — the edge service writes.
// POC scope: farm_anike_001 / house1 / mic_001. See acoustic-feature-handover.md.

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { queryInflux } from "./influxdb";

const REGION = process.env.AWS_REGION ?? "af-south-1";
const RAW_BUCKET = "senseagri-dev-raw";
const EVENTS_PREFIX = "raw/events/";
const CLIP_BUCKET = "senseagri-dev-media-inference";
export const CLIP_PREFIX = "events/audio/";

const ID_RE = /^[A-Za-z0-9_-]+$/;
const DAY_MS = 86_400_000;

export type NoisePoint = { time: string; mean: number | null; max: number | null; baseline: number | null };
export type Anomaly = { time: string; peakDb: number | null; baselineDb: number | null; clipKey: string | null; clipSeconds: number | null };

// range → InfluxDB window + bin (keeps point counts ~700 across ranges)
const RANGES: Record<string, { hours: number; bin: string }> = {
  "24h": { hours: 24, bin: "2 minutes" },
  "7d": { hours: 168, bin: "15 minutes" },
  "30d": { hours: 720, bin: "1 hour" },
};
export const isAcousticRange = (r: string): r is keyof typeof RANGES => r in RANGES;
export const rangeHours = (r: string): number => (RANGES[r] ?? RANGES["24h"]).hours;

let _s3: S3Client | null = null;
const s3 = (): S3Client => (_s3 ??= new S3Client({ region: REGION }));

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return new Date(Number(v) / 1e6).toISOString(); // ns → ms
  if (typeof v === "number") return new Date(v > 1e14 ? v / 1e6 : v).toISOString();
  const s = String(v);
  const d = new Date(s.includes("T") || s.endsWith("Z") ? s : `${s.replace(" ", "T")}Z`);
  return isNaN(d.getTime()) ? s : d.toISOString();
}
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Per-bucket flock-noise level for [now-range, now]. Empty if the measurement has no data yet. */
export async function fetchNoiseSeries(farmId: string, houseId: string, range: string): Promise<NoisePoint[]> {
  if (!ID_RE.test(farmId) || !ID_RE.test(houseId)) throw new Error("Invalid farm/house id");
  const r = RANGES[range] ?? RANGES["24h"];
  const sql = `
    SELECT
      date_bin(INTERVAL '${r.bin}', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
      AVG(noise_db_mean) AS mean,
      MAX(noise_db_max)  AS max,
      AVG(baseline_db)   AS baseline
    FROM audio_noise
    WHERE farm_id = '${farmId}' AND house_id = '${houseId}'
      AND time > now() - INTERVAL '${r.hours} hours'
    GROUP BY bucket
    ORDER BY bucket ASC`;
  const rows = await queryInflux<Record<string, unknown>>(sql);
  return rows.map((row) => ({
    time: toIso(row.bucket),
    mean: toNum(row.mean),
    max: toNum(row.max),
    baseline: toNum(row.baseline),
  }));
}

// Anomaly events are raw JSON with no type in the key, so we list the day partitions and read each.
// Sparse in practice (≤1 clip / 5 min), but cache + cap so a wide range can't fan out unbounded.
const CACHE_TTL_MS = 60 * 1000;
const anomCache = new Map<string, { at: number; rows: Anomaly[] }>();
const MAX_OBJECTS = 800;
const CHUNK = 25;

function datesInRange(fromMs: number, toMs: number, cap = 40): string[] {
  const out: string[] = [];
  for (let d = Math.floor(fromMs / DAY_MS) * DAY_MS; d <= toMs && out.length < cap; d += DAY_MS) {
    out.push(new Date(d).toISOString().slice(0, 10));
  }
  return out;
}

/** Audio-anomaly events for this farm/house within [fromMs, toMs], newest last. */
export async function fetchAnomalies(farmId: string, houseId: string, fromMs: number, toMs: number): Promise<Anomaly[]> {
  const dates = datesInRange(fromMs, toMs);
  const cacheKey = `${farmId}|${houseId}|${dates[0]}|${dates[dates.length - 1]}`;
  const hit = anomCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

  const client = s3();

  // 1. Collect candidate keys across the day partitions (capped).
  const keys: string[] = [];
  for (const date of dates) {
    let token: string | undefined;
    do {
      const list = await client.send(new ListObjectsV2Command({
        Bucket: RAW_BUCKET, Prefix: `${EVENTS_PREFIX}date=${date}/`, ContinuationToken: token, MaxKeys: 1000,
      }));
      for (const o of list.Contents ?? []) if (o.Key && keys.length < MAX_OBJECTS) keys.push(o.Key);
      token = list.IsTruncated && keys.length < MAX_OBJECTS ? list.NextContinuationToken : undefined;
    } while (token);
    if (keys.length >= MAX_OBJECTS) break;
  }

  // 2. Read + filter to audio_anomaly for this farm/house in-window, in parallel chunks.
  const out: Anomaly[] = [];
  for (let i = 0; i < keys.length; i += CHUNK) {
    const batch = await Promise.all(keys.slice(i, i + CHUNK).map(async (Key) => {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: RAW_BUCKET, Key }));
        const body = await res.Body?.transformToString();
        if (!body) return null;
        const p = (JSON.parse(body) as { payload?: Record<string, unknown> }).payload;
        if (!p || p.event_type !== "audio_anomaly" || p.farm_id !== farmId || p.house_id !== houseId) return null;
        const t = new Date(String(p.timestamp)).getTime();
        if (isNaN(t) || t < fromMs || t > toMs) return null;
        return {
          time: new Date(t).toISOString(),
          peakDb: toNum(p.peak_db),
          baselineDb: toNum(p.baseline_db),
          clipKey: typeof p.clip_s3_key === "string" ? p.clip_s3_key : null,
          clipSeconds: toNum(p.clip_seconds),
        } as Anomaly;
      } catch {
        return null; // skip unreadable / malformed
      }
    }));
    for (const a of batch) if (a) out.push(a);
  }

  out.sort((a, b) => a.time.localeCompare(b.time));
  anomCache.set(cacheKey, { at: Date.now(), rows: out });
  return out;
}

/** Presigned GET URL for a clip. Caller must have already confirmed the key belongs to their farm. */
export async function presignClip(key: string): Promise<string> {
  if (!key.startsWith(CLIP_PREFIX)) throw new Error("Invalid clip key");
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: CLIP_BUCKET, Key: key }), { expiresIn: 300 });
}

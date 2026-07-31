// Egg-counting reader — live per-camera counts (InfluxDB `egg_count`) + annotated
// evidence clips (S3 media-inference). Two Bierman collectors, one camera each:
//   cam_001 → house_a (A-frame 1),  cam_002 → house_b (A-frame 2).
// Reads only; the platform's edge service writes. See egg-counting-dashboard-handover.md.
//
// Farm-scoped: every query is bounded by the caller's farm_id (resolved from the Clerk
// org server-side). Clip keys are only ever built by listing under the farm's OWN prefix
// — the client never supplies a raw S3 key — so one org can never reach another's clips.

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { queryInflux } from "./influxdb";

const REGION = process.env.AWS_REGION ?? "af-south-1";
export const CLIP_BUCKET = "senseagri-dev-media-inference";
const CLIP_ROOT = "clips/"; // clips/farm_id=<farm>/camera_id=<cam>/date=<YYYY-MM-DD>/job_id=no_job/<ts>_<uuid>.mp4

export const ID_RE = /^[A-Za-z0-9_-]+$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

// Fallback camera→frame map (per handover). The two cameras cover the two A-frames (A / B) — these
// are collectors, NOT separate houses. Live counts carry the id in the house_id tag; this only fills
// in labels for cameras discovered via S3 that have no recent counts.
export const CAMERA_HOUSE: Record<string, string> = { cam_001: "house_a", cam_002: "house_b" };

/** Display label for an A-frame from its tag id, e.g. "house_a" → "A-frame A". */
export function frameLabel(frameId: string | null | undefined): string {
  if (!frameId) return "A-frame";
  const m = frameId.match(/^house[_-]?(.+)$/i);
  return `A-frame ${(m ? m[1] : frameId).toUpperCase()}`;
}

export type EggRange = "24h" | "7d" | "30d";
const RANGES: Record<EggRange, { hours: number; bin: string }> = {
  "24h": { hours: 24, bin: "15 minutes" },
  "7d": { hours: 168, bin: "3 hours" },
  "30d": { hours: 720, bin: "1 day" },
};
export const isEggRange = (r: string): r is EggRange => r in RANGES;

export type EggSeriesRow = { time: string; houseId: string; cameraId: string; eggs: number };
export type EggTotal = { houseId: string; cameraId: string; eggsToday: number };
export type EggClip = { key: string; capturedAt: string | null; url: string };

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
const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Binned egg counts (SUM of eggs_window) per camera/house over the range, oldest first. */
export async function fetchEggSeries(farmId: string, range: EggRange): Promise<EggSeriesRow[]> {
  if (!ID_RE.test(farmId)) throw new Error("Invalid farm id");
  const r = RANGES[range];
  const sql = `
    SELECT
      date_bin(INTERVAL '${r.bin}', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
      house_id, camera_id,
      SUM(eggs_window) AS eggs
    FROM egg_count
    WHERE farm_id = '${farmId}'
      AND time > now() - INTERVAL '${r.hours} hours'
    GROUP BY bucket, house_id, camera_id
    ORDER BY bucket ASC`;
  const rows = await queryInflux<Record<string, unknown>>(sql);
  return rows.map((row) => ({
    time: toIso(row.bucket),
    houseId: String(row.house_id ?? ""),
    cameraId: String(row.camera_id ?? ""),
    eggs: toNum(row.eggs),
  }));
}

/** Today's egg total per camera (UTC day). Uses eggs_window (restart-safe), per handover. */
export async function fetchEggTotalsToday(farmId: string): Promise<EggTotal[]> {
  if (!ID_RE.test(farmId)) throw new Error("Invalid farm id");
  const sql = `
    SELECT house_id, camera_id, SUM(eggs_window) AS eggs_today
    FROM egg_count
    WHERE farm_id = '${farmId}' AND time >= date_trunc('day', now())
    GROUP BY house_id, camera_id`;
  const rows = await queryInflux<Record<string, unknown>>(sql);
  return rows.map((row) => ({
    houseId: String(row.house_id ?? ""),
    cameraId: String(row.camera_id ?? ""),
    eggsToday: toNum(row.eggs_today),
  }));
}

/** Cameras that have any clips for this farm (S3 common-prefix scan). */
export async function discoverEggCameras(farmId: string): Promise<string[]> {
  if (!ID_RE.test(farmId)) throw new Error("Invalid farm id");
  const list = await s3().send(new ListObjectsV2Command({
    Bucket: CLIP_BUCKET, Prefix: `${CLIP_ROOT}farm_id=${farmId}/`, Delimiter: "/",
  }));
  const cams: string[] = [];
  for (const p of list.CommonPrefixes ?? []) {
    const m = p.Prefix?.match(/camera_id=([^/]+)\//);
    if (m) cams.push(m[1]);
  }
  return cams;
}

async function listDayObjects(farmId: string, cameraId: string, date: string) {
  const list = await s3().send(new ListObjectsV2Command({
    Bucket: CLIP_BUCKET,
    Prefix: `${CLIP_ROOT}farm_id=${farmId}/camera_id=${cameraId}/date=${date}/`,
    MaxKeys: 200,
  }));
  return (list.Contents ?? [])
    .filter((o) => o.Key?.endsWith(".mp4"))
    .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0)); // newest first
}

/** Presigned clips for one camera on one date (server lists under the farm's own prefix). */
export async function listEggClips(farmId: string, cameraId: string, date: string): Promise<EggClip[]> {
  if (!ID_RE.test(farmId) || !ID_RE.test(cameraId) || !DATE_RE.test(date)) throw new Error("Invalid clip query");
  const objects = await listDayObjects(farmId, cameraId, date);
  return Promise.all(objects.map(async (o) => ({
    key: o.Key!,
    capturedAt: o.LastModified?.toISOString() ?? null,
    url: await getSignedUrl(s3(), new GetObjectCommand({ Bucket: CLIP_BUCKET, Key: o.Key! }), { expiresIn: 3600 }),
  })));
}

export type ResolvedClips = { cameraId: string; date: string | null; isFallback: boolean; clips: EggClip[] };

/** Latest clips for a camera: today (UTC) if present, else walk back to the most recent day
 *  that has clips (so a player is never empty). */
export async function resolveLatestEggClips(farmId: string, cameraId: string, lookbackDays = 21): Promise<ResolvedClips> {
  if (!ID_RE.test(farmId) || !ID_RE.test(cameraId)) throw new Error("Invalid camera");
  const todayUtc = new Date().toISOString().slice(0, 10);
  for (let i = 0; i <= lookbackDays; i++) {
    const date = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    const objects = await listDayObjects(farmId, cameraId, date);
    if (objects.length) {
      const clips = await Promise.all(objects.map(async (o) => ({
        key: o.Key!,
        capturedAt: o.LastModified?.toISOString() ?? null,
        url: await getSignedUrl(s3(), new GetObjectCommand({ Bucket: CLIP_BUCKET, Key: o.Key! }), { expiresIn: 3600 }),
      })));
      return { cameraId, date, isFallback: date !== todayUtc, clips };
    }
  }
  return { cameraId, date: null, isFallback: false, clips: [] };
}

/** True if `key` is a clip that belongs to this farm (used to gate the transcode proxy). */
export function isFarmClipKey(farmId: string, key: string): boolean {
  return ID_RE.test(farmId) && key.startsWith(CLIP_ROOT) && key.includes(`farm_id=${farmId}/`) && key.endsWith(".mp4");
}

/** Raw bytes of a clip object (caller must have validated the key belongs to the farm). */
export async function fetchClipBytes(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: CLIP_BUCKET, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error("Empty clip body");
  return Buffer.from(bytes);
}

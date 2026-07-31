import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { isFarmClipKey, fetchClipBytes } from "@/lib/eggCountSource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Transcode proxy: the egg clips are written as mp4v (MPEG-4 Part 2), which Chrome/Firefox can't
// decode inline. This pulls the clip from S3 and re-encodes it to H.264 on demand (cached in the
// OS temp dir), then streams it to the <video> element with Range support so it plays in-app.
// Farm-scoped: the key must belong to the caller's farm (clips/farm_id=<farm.farmId>/…).
//
// The proper long-term fix is to encode H.264 at the source (the capture pipeline); this proxy is the
// interim so playback works without that change.

const execFileAsync = promisify(execFile);
const inflight = new Map<string, Promise<string>>();

async function ensureH264(key: string): Promise<string> {
  const hash = createHash("sha1").update(key).digest("hex");
  const dir = path.join(os.tmpdir(), "egg-h264");
  const outPath = path.join(dir, `${hash}.mp4`);
  try { await fs.access(outPath); return outPath; } catch { /* not cached yet */ }

  const existing = inflight.get(key);
  if (existing) return existing;

  const job = (async () => {
    if (!ffmpegPath) throw new Error("ffmpeg binary unavailable");
    await fs.mkdir(dir, { recursive: true });
    const srcPath = path.join(dir, `${hash}.src.mp4`);
    await fs.writeFile(srcPath, await fetchClipBytes(key));
    await execFileAsync(ffmpegPath, [
      "-y", "-i", srcPath,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", // annotated clips are silent
      outPath,
    ], { maxBuffer: 1 << 26 });
    await fs.unlink(srcPath).catch(() => {});
    return outPath;
  })();

  inflight.set(key, job);
  try { return await job; } finally { inflight.delete(key); }
}

export async function GET(req: NextRequest) {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!isFarmClipKey(farm.farmId, key)) {
    return NextResponse.json({ error: "Invalid or out-of-scope clip key" }, { status: 400 });
  }

  let outPath: string;
  try {
    outPath = await ensureH264(key);
  } catch (e) {
    console.error("Egg clip transcode failed:", e);
    return NextResponse.json({ error: "Failed to prepare clip for playback" }, { status: 500 });
  }

  const total = (await fs.stat(outPath)).size;
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
    if (Number.isNaN(start) || start >= total || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
    }
    const len = end - start + 1;
    const fh = await fs.open(outPath, "r");
    try {
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      return new Response(buf, {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(len) },
      });
    } finally {
      await fh.close();
    }
  }

  const buf = await fs.readFile(outPath);
  return new Response(buf, { status: 200, headers: { ...headers, "Content-Length": String(total) } });
}

// One-off: list the acoustic anomaly events (with their audio clip keys) so we can hear what the
// night-time noise events actually were. Reuses the app's acousticSource (S3 event reader).
//   run:  npx tsx analysis/dump_anomalies.ts
import { readFileSync } from "fs";
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* defaults + ~/.aws */ }

const FARM = process.env.FARM_ID ?? "farm_anike_001";
const HOUSE = process.env.HOUSE_ID ?? "house1";
const DAYS = Number(process.env.DAYS ?? 30);

async function main() {
  const { fetchAnomalies } = await import("../src/lib/acousticSource");
  const now = Date.now();
  const from = now - DAYS * 86_400_000;
  console.log(`fetching anomalies for ${FARM}/${HOUSE}, last ${DAYS} days…`);
  const anoms = await fetchAnomalies(FARM, HOUSE, from, now);
  console.log(`${anoms.length} anomalies\n`);
  console.log("SAST time            peakDb  base   secs  night  clipKey");
  for (const a of anoms) {
    const sast = new Date(new Date(a.time).getTime() + 2 * 3_600_000);
    const h = sast.getUTCHours();
    const night = h >= 20 || h < 5;
    const ds = sast.toISOString().slice(0, 16).replace("T", " ");
    console.log(
      `${ds}  ${String(a.peakDb ?? "").padStart(6)}  ${String(a.baselineDb ?? "").padStart(5)}  ` +
      `${String(a.clipSeconds ?? "").padStart(4)}  ${night ? "NIGHT" : "     "}  ${a.clipKey ?? "(no clip)"}`
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

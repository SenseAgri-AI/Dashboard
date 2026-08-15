// One-off: dump the farm's audio_noise history to CSV for the night-acoustics investigation.
// Reuses the app's proven InfluxDB client (src/lib/influxdb) so we connect exactly like the app does.
//   run:  npx tsx analysis/dump_audio_noise.ts     (from the repo root)
//   env:  FARM_ID (default farm_anike_001), DAYS (default 30)
import { readFileSync, writeFileSync } from "fs";

// Load .env.local so the influx client sees the same config/credentials the app uses.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env.local — rely on defaults + ~/.aws creds */ }

const FARM = process.env.FARM_ID ?? "farm_anike_001";
const DAYS = Number(process.env.DAYS ?? 30);

async function main() {
  // Import AFTER env is set (dynamic import isn't hoisted).
  const { queryInflux } = await import("../src/lib/influxdb");

  console.log(`querying audio_noise for ${FARM}, last ${DAYS} days…`);
  const rows = await queryInflux<Record<string, unknown>>(`
    SELECT time, house_id, noise_db_mean, noise_db_max, baseline_db
    FROM audio_noise
    WHERE farm_id = '${FARM}' AND time > now() - interval '${DAYS} days'
    ORDER BY time ASC
  `);

  const num = (v: unknown) => (v == null ? "" : String(v));
  const iso = (v: unknown): string => {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "bigint") return new Date(Number(v) / 1e6).toISOString(); // ns → ms
    if (typeof v === "number") return new Date(v > 1e14 ? v / 1e6 : v).toISOString();
    const s = String(v);
    const d = new Date(s.includes("T") || s.endsWith("Z") ? s : `${s.replace(" ", "T")}Z`);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  };
  const header = "time,house_id,noise_db_mean,noise_db_max,baseline_db";
  const lines = rows.map((r) => `${iso(r.time)},${num(r.house_id)},${num(r.noise_db_mean)},${num(r.noise_db_max)},${num(r.baseline_db)}`);
  const out = "analysis/audio_noise.csv";
  writeFileSync(out, [header, ...lines].join("\n"));
  console.log(`wrote ${rows.length} rows to ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError, type FarmConfig } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";
import { mergeThresholds } from "@/lib/todayStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Last-reading time per data stream for the Home freshness badges. Read-only, farm-scoped.
// A failed query returns `undefined` for that stream ("couldn't check"), never "stale".
const LOOKBACK = "interval '7 days'";
const DEVICE_ID = /^[0-9a-f]{16}$/i;

function toMs(t: unknown): number | null {
  if (t == null) return null;
  const ms = t instanceof Date ? t.getTime()
    : typeof t === "bigint" ? Number(t) / 1e6
    : typeof t === "number" ? (t > 1e14 ? t / 1e6 : t)
    : new Date(String(t)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function waterMetersFor(farm: Pick<FarmConfig, "waterMeters" | "waterDeviceId">): { deviceId: string; name: string }[] {
  const list = farm.waterMeters?.length ? farm.waterMeters
    : farm.waterDeviceId ? [{ deviceId: farm.waterDeviceId, name: "Water meter" }] : [];
  return list.filter((m) => DEVICE_ID.test(m.deviceId));
}

async function lastTime(sql: string): Promise<number | null> {
  const rows = await queryInflux<{ last: unknown }>(sql);
  return toMs(rows[0]?.last);
}

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
  const f = farm.farmId.replace(/'/g, "''");
  const meters = waterMetersFor(farm);
  const ids = meters.map((m) => `'${m.deviceId}'`).join(", ");

  const [climate, silo, audio, eggCamera, water] = await Promise.allSettled([
    lastTime(`SELECT MAX(time) AS last FROM sensors WHERE farm_id = '${f}' AND device_type = 'AM308-1' AND time > now() - ${LOOKBACK}`),
    lastTime(`SELECT MAX(time) AS last FROM sensors WHERE farm_id = '${f}' AND device_type = 'EM411-RDL' AND time > now() - ${LOOKBACK}`),
    lastTime(`SELECT MAX(time) AS last FROM audio_noise WHERE farm_id = '${f}' AND time > now() - ${LOOKBACK}`),
    lastTime(`SELECT MAX(time) AS last FROM egg_count WHERE farm_id = '${f}' AND time > now() - ${LOOKBACK}`),
    meters.length
      ? queryInflux<{ device_id: unknown; last: unknown }>(`SELECT device_id, MAX(time) AS last FROM sensors WHERE farm_id = '${f}' AND device_id IN (${ids}) AND pulse_total IS NOT NULL AND time > now() - ${LOOKBACK} GROUP BY device_id`)
      : Promise.resolve([]),
  ]);
  const val = (r: PromiseSettledResult<number | null>) => (r.status === "fulfilled" ? r.value : undefined);
  const iso = (ms: number | null | undefined) => (ms === undefined ? undefined : ms === null ? null : new Date(ms).toISOString());
  for (const [k, r] of Object.entries({ climate, silo, audio, eggCamera, water })) {
    if (r.status === "rejected") console.error(`freshness: ${k} query failed`);
  }
  const waterRows = water.status === "fulfilled" ? water.value : null;
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    streams: {
      climate: iso(val(climate)),
      silo: iso(val(silo)),
      audio: iso(val(audio)),
      eggCamera: iso(val(eggCamera)),
    },
    // `lastSeen: undefined` (omitted in JSON) = couldn't check; `null` = no reading in 7 days.
    water: meters.map((m) => {
      if (!waterRows) return { name: m.name };
      const row = waterRows.find((r) => String(r.device_id) === m.deviceId);
      const ms = row ? toMs(row.last) : null;
      return { name: m.name, lastSeen: ms == null ? null : new Date(ms).toISOString() };
    }),
    thresholds: mergeThresholds(farm.today),
    timezoneOffset: farm.timezoneOffset ?? 2,
  }, { headers: { "Cache-Control": "no-store" } });
}

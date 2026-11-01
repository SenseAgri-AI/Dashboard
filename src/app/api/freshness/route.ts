import { NextResponse } from "next/server";
import { getFarmForRequest, FarmAccessError, type FarmConfig } from "@/lib/farms";
import { queryInflux } from "@/lib/influxdb";
import { mergeThresholds } from "@/lib/todayStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Last-reading time per farmer-facing data stream (climate, each water meter, each silo radar) for the Home Today card. Read-only, farm-scoped.
// A failed query returns `undefined` for that stream ("couldn't check"), never "stale".
const LOOKBACK = "interval '7 days'";
const DEVICE_ID = /^[0-9a-f]{16}$/i;
// Same exclusion and ordering as /api/silo-levels, so "Silo 1/2" match the silo cards.
const NON_PHYSICAL_DEVICE = /(test|demo|mock|simulator|virtual)/i;

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

  // Only streams the farmer is told about. Sound and the egg camera are SenseAgri ops checks.
  const [climate, silo, water] = await Promise.allSettled([
    lastTime(`SELECT MAX(time) AS last FROM sensors WHERE farm_id = '${f}' AND device_type = 'AM308-1' AND time > now() - ${LOOKBACK}`),
    // Per radar: one silent radar must not be hidden by the other one's fresh readings.
    queryInflux<{ device_id: unknown; last: unknown }>(`SELECT device_id, MAX(time) AS last FROM sensors WHERE farm_id = '${f}' AND device_type = 'EM411-RDL' AND time > now() - ${LOOKBACK} GROUP BY device_id`),
    meters.length
      ? queryInflux<{ device_id: unknown; last: unknown }>(`SELECT device_id, MAX(time) AS last FROM sensors WHERE farm_id = '${f}' AND device_id IN (${ids}) AND pulse_total IS NOT NULL AND time > now() - ${LOOKBACK} GROUP BY device_id`)
      : Promise.resolve([]),
  ]);
  const val = (r: PromiseSettledResult<number | null>) => (r.status === "fulfilled" ? r.value : undefined);

  const iso = (ms: number | null | undefined) => (ms === undefined ? undefined : ms === null ? null : new Date(ms).toISOString());
  for (const [k, r] of Object.entries({ climate, silo, water })) {
    if (r.status === "rejected") console.error(`freshness: ${k} query failed`);
  }
  const waterRows = water.status === "fulfilled" ? water.value : null;
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    streams: {
      climate: iso(val(climate)),
    },
    // `undefined` (omitted in JSON) = that query failed; a radar silent for over 7 days drops out of
    // this list, and the silo cards (30-day window) still show it.
    silos: silo.status === "fulfilled"
      ? silo.value
        .map((r) => ({ deviceId: String(r.device_id ?? "").trim(), ms: toMs(r.last) }))
        .filter((r) => r.deviceId && !NON_PHYSICAL_DEVICE.test(r.deviceId))
        .sort((a, b) => a.deviceId.localeCompare(b.deviceId))
        .slice(0, 2)
        .map((r, i) => ({ name: `Silo ${i + 1}`, lastSeen: r.ms == null ? null : new Date(r.ms).toISOString() }))
      : undefined,
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

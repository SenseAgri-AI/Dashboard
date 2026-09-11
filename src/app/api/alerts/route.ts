import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { readLegacyAlerts } from "@/lib/legacyAlertReader";
import { storedAlert } from "@/lib/alerts";
import { fetchAnomalies } from "@/lib/acousticSource";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? "af-south-1" }));

export async function GET() {
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }
  try {
    const rows: Record<string, unknown>[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await client.send(new QueryCommand({
        TableName: process.env.ALERTS_TABLE ?? "senseagri-dev-alerts",
        KeyConditionExpression: "farm_id = :farm",
        FilterExpression: "#state = :firing OR alert_id = :status",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":farm": farm.farmId, ":firing": "firing", ":status": "_status#notifier" },
        ConsistentRead: true,
        ExclusiveStartKey: cursor,
      }));
      rows.push(...(page.Items ?? []));
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    const heartbeat = rows.find((r) => r.alert_id === "_status#notifier");
    if (!heartbeat) {
      if (process.env.ALERTS_REQUIRE_SHARED === "true") {
        return NextResponse.json({ error: "Farm alerts are awaiting their first scheduled check" }, { status: 503 });
      }
      // Keep existing dashboard alerts available until the platform is deployed.
      // A successful writer heartbeat switches this farm to the shared store.
      return NextResponse.json(await readLegacyAlerts(farm), { headers: { "Cache-Control": "no-store" } });
    }
    const alerts = rows.map(storedAlert).filter((a) => a !== null);
    // Attach optional evidence to an already evaluated episode. No rules run here.
    for (const alert of alerts) {
      if (!alert.id.startsWith("night_disturbance#") || alert.clipKey || !alert.since) continue;
      const eventMs = Date.parse(alert.since);
      if (!Number.isFinite(eventMs)) continue;
      try {
        const house = Object.keys(farm.houseHens ?? {})[0] || "house1";
        const clips = (await fetchAnomalies(farm.farmId, house, eventMs - 900_000, eventMs + 900_000)).filter((c) => c.clipKey);
        clips.sort((a, b) => Math.abs(Date.parse(a.time) - eventMs) - Math.abs(Date.parse(b.time) - eventMs));
        alert.clipKey = clips[0]?.clipKey ?? null;
      } catch { console.error("alerts: optional clip lookup failed"); }
    }
    const rank = { danger: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
    const updatedAt = typeof heartbeat.last_checked === "string" ? heartbeat.last_checked : null;
    const stale = !updatedAt || !Number.isFinite(Date.parse(updatedAt)) || Date.now() - Date.parse(updatedAt) > 2 * 3_600_000;
    return NextResponse.json({ alerts, updatedAt, source: "shared", stale, partial: heartbeat.status !== "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("alerts: shared store read failed", err);
    if (process.env.ALERTS_REQUIRE_SHARED !== "true") {
      try {
        return NextResponse.json(await readLegacyAlerts(farm), { headers: { "Cache-Control": "no-store" } });
      } catch { console.error("alerts: migration fallback failed"); }
    }
    return NextResponse.json({ error: "Alerts are temporarily unavailable" }, { status: 503 });
  }
}

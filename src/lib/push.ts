// Web Push notifications — the server side. Subscriptions are stored FARM-SCOPED in DynamoDB:
// partition key farmId, sort key endpoint (one row per device), with the Clerk userId kept as an
// attribute. Alerts are farm-scoped, so the notifier queries a whole farm's devices at once; the
// dashboard resolves a Clerk user → org → farmId (getFarmForRequest) before writing.
// Independent of the dashboard UI — any server code (a route, or the platform alerts Lambda) can
// call sendToFarm()/sendToDevice() to make a notification appear on subscribed devices.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { validSubscription } from "./pushValidation";
import webpush, { type PushSubscription } from "web-push";

const REGION = process.env.AWS_REGION ?? "af-south-1";
const TABLE = process.env.PUSH_TABLE ?? "senseagri-dev-push-subscriptions";

let _doc: DynamoDBDocumentClient | null = null;
function doc(): DynamoDBDocumentClient {
  if (!_doc) _doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  return _doc;
}

export function vapidConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

let _vapidReady = false;
function ensureVapid(): boolean {
  if (_vapidReady) return true;
  if (!vapidConfigured()) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  _vapidReady = true;
  return true;
}

export type StoredSub = { farmId: string; endpoint: string; userId: string; keys: { p256dh: string; auth: string }; createdAt: string };
export type PushPayload = { title: string; body: string; url?: string; tag?: string; testId?: string };

export async function saveSubscription(farmId: string, userId: string, sub: PushSubscription): Promise<void> {
  await doc().send(new PutCommand({
    TableName: TABLE,
    Item: { farmId, endpoint: sub.endpoint, userId, keys: sub.keys, createdAt: new Date().toISOString() },
  }));
}

export async function deleteSubscription(farmId: string, endpoint: string, userId?: string): Promise<void> {
  await doc().send(new DeleteCommand({ TableName: TABLE, Key: { farmId, endpoint },
    ...(userId ? { ConditionExpression: "attribute_not_exists(endpoint) OR userId = :user", ExpressionAttributeValues: { ":user": userId } } : {}),
  }));
}

/** All devices subscribed under a farm (across every user in that farm's org). */
export async function getFarmSubscriptions(farmId: string): Promise<StoredSub[]> {
  const items: StoredSub[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const res = await doc().send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "farmId = :f",
      ExpressionAttributeValues: { ":f": farmId }, ExclusiveStartKey: cursor,
    }));
    items.push(...(res.Items ?? []) as StoredSub[]);
    cursor = res.LastEvaluatedKey;
  } while (cursor);
  return items;
}

// Deliver one payload to a set of subscriptions, pruning dead ones (410 Gone / 404).
async function deliver(subs: StoredSub[], payload: PushPayload): Promise<{ sent: number; removed: number }> {
  if (!ensureVapid()) throw new Error("Push not configured (VAPID keys missing)");
  let sent = 0, removed = 0;
  await Promise.all(subs.map(async (s) => {
    if (!validSubscription(s)) return;
    const subscription: PushSubscription = { endpoint: s.endpoint, keys: s.keys };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), { timeout: 8000, TTL: 3600 });
      sent++;
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        try { await deleteSubscription(s.farmId, s.endpoint); removed++; }
        catch { console.error("push: dead subscription cleanup failed"); }
      }
      else console.error("push send failed:", code, e instanceof Error ? e.message : e);
    }
  }));
  return { sent, removed };
}

/** Notify EVERY device subscribed under a farm — this is what the alerts notifier uses. */
export async function sendToFarm(farmId: string, payload: PushPayload): Promise<{ sent: number; removed: number }> {
  return deliver(await getFarmSubscriptions(farmId), payload);
}

/** A test targets one stored subscription belonging to this user and farm.
 * Never fan out to the user's other devices. */
export async function sendToDevice(farmId: string, userId: string, endpoint: string, payload: PushPayload): Promise<"accepted" | "not-found" | "expired"> {
  const res = await doc().send(new QueryCommand({
    TableName: TABLE, KeyConditionExpression: "farmId = :farm AND endpoint = :endpoint",
    ExpressionAttributeValues: { ":farm": farmId, ":endpoint": endpoint }, ConsistentRead: true,
  }));
  const sub = res.Items?.[0];
  if (!sub || sub.farmId !== farmId || sub.userId !== userId || sub.endpoint !== endpoint || !validSubscription(sub)) return "not-found";
  if (!ensureVapid()) throw new Error("Push not configured");
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { timeout: 8000, TTL: 60 });
    return "accepted";
  } catch (error) {
    const code = (error as { statusCode?: number }).statusCode;
    if (code !== 404 && code !== 410) throw error;
    try { await deleteSubscription(farmId, endpoint, userId); }
    catch { console.error("push: expired test subscription cleanup failed"); }
    return "expired";
  }
}

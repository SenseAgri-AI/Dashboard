// Push sends perform server-side HTTP requests. Accept only known browser push
// services, HTTPS, and correctly sized Web Push keys.
export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname;
    const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
      host === "web.push.apple.com" || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
    return allowed && url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash;
  } catch { return false; }
}

export function validSubscription(value: unknown): value is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!value || typeof value !== "object") return false;
  const sub = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!validPushEndpoint(sub.endpoint) || !sub.keys) return false;
  const { p256dh, auth } = sub.keys;
  if (typeof p256dh !== "string" || typeof auth !== "string" ||
      !/^[A-Za-z0-9_-]{87}=?$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}(==)?$/.test(auth)) return false;
  const key = Buffer.from(p256dh, "base64url");
  return key.length === 65 && key[0] === 4 && Buffer.from(auth, "base64url").length === 16;
}

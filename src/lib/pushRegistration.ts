/** Register an already-authorized device. Permission requests belong in a user click handler. */
export async function registerPushDevice(publicKey: string, signal?: AbortSignal): Promise<void> {
  if (Notification.permission !== "granted" || signal?.aborted) return;
  await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  const reg = await navigator.serviceWorker.ready;
  if (signal?.aborted) return;
  const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(publicKey.length / 4) * 4, "="));
  const key = Uint8Array.from(raw, c => c.charCodeAt(0));
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  if (signal?.aborted) return;
  const res = await fetch("/api/push/subscribe", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }), signal,
  });
  if (!res.ok) throw new Error("Couldn't enable farm alerts. Please try again.");
}
